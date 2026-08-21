'use strict';

const { ApiError } = require('./errors');

async function findTransition(client, fromState, toState) {
  const result = await client.query(
    `SELECT required_role, requires_rationale, guard_expression
       FROM workflow_transitions
      WHERE from_state = $1 AND to_state = $2`,
    [fromState, toState]
  );
  return result.rows[0] || null;
}

async function guardPasses(client, transition, caseRecord, context = {}) {
  switch (transition.guard_expression) {
    case null:
      return true;
    case 'mandatory_fields_present': {
      const parties = await client.query(
        `SELECT count(*)::int AS count FROM case_parties WHERE case_id = $1 AND tenant_id = $2`,
        [caseRecord.id, caseRecord.tenant_id]
      );
      return Boolean(caseRecord.case_ref && caseRecord.destination_country && caseRecord.stated_end_use)
        && parties.rows[0].count > 0;
    }
    case 'confirmed_sanctions_match OR comprehensive_embargo_without_licence': {
      const result = await client.query(
        `SELECT (
           EXISTS (
             SELECT 1 FROM screening_results
              JOIN list_sources ls ON ls.code = screening_results.source_code
              WHERE case_id = $1 AND tenant_id = $2
                AND status = 'CONFIRMED_HIT' AND ls.is_blocking = TRUE
           )
           OR (
             EXISTS (
               SELECT 1
                 FROM country_embargo_programs cep
                 JOIN embargo_programs ep ON ep.code = cep.program_code
                WHERE cep.country_code = $3 AND ep.is_comprehensive = TRUE
             )
             AND NOT EXISTS (
               SELECT 1 FROM licence_determinations
                WHERE case_id = $1 AND tenant_id = $2 AND outcome IN ('EXCEPTION', 'REQUIRED')
             )
           )
         ) AS passes`,
        [caseRecord.id, caseRecord.tenant_id, caseRecord.destination_country]
      );
      return result.rows[0].passes;
    }
    case 'possible_hit OR low_confidence OR unresolved_red_flag': {
      const result = await client.query(
        `SELECT (
           EXISTS (
             SELECT 1 FROM screening_results
              WHERE case_id = $1 AND tenant_id = $2 AND status = 'POSSIBLE_HIT'
           )
           OR EXISTS (
             SELECT 1
               FROM screening_results sr
               JOIN list_sources ls ON ls.code = sr.source_code
              WHERE sr.case_id = $1 AND sr.tenant_id = $2
                AND sr.status = 'CONFIRMED_HIT' AND ls.is_blocking = FALSE
           )
           OR EXISTS (
             SELECT 1 FROM screening_results
              WHERE case_id = $1 AND tenant_id = $2 AND status = 'CLEAR' AND top_score > 0
           )
           OR EXISTS (
             SELECT 1 FROM red_flag_records
              WHERE case_id = $1 AND tenant_id = $2 AND resolution_status = 'OPEN'
           )
         ) AS passes`,
        [caseRecord.id, caseRecord.tenant_id]
      );
      return result.rows[0].passes;
    }
    case 'screening_complete AND classification_complete': {
      const result = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM screening_results WHERE case_id = $1 AND tenant_id = $2) AS screened,
            EXISTS (SELECT 1 FROM case_products WHERE case_id = $1 AND tenant_id = $2)
            AND NOT EXISTS (
              SELECT 1
                FROM case_products cp
               WHERE cp.case_id = $1
                 AND cp.tenant_id = $2
                 AND NOT EXISTS (
                   SELECT 1
                     FROM classification_results cr
                    WHERE cr.case_id = cp.case_id
                      AND cr.product_id = cp.product_id
                      AND cr.tenant_id = cp.tenant_id
                      AND cr.status IN ('CLASSIFIED', 'EAR99')
                      AND cr.requires_revalidation = FALSE
                      AND cr.requires_human_review = FALSE
                 )
            ) AS classified`,
        [caseRecord.id, caseRecord.tenant_id]
      );
      return result.rows[0].screened && result.rows[0].classified;
    }
    case 'all_agents_clear AND no_rule_fired AND plan_permits_auto_clear': {
      const result = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM screening_results WHERE case_id = $1 AND tenant_id = $2) AS screened,
           NOT EXISTS (
             SELECT 1 FROM screening_results
              WHERE case_id = $1 AND tenant_id = $2 AND status <> 'CLEAR'
           ) AS clear`,
        [caseRecord.id, caseRecord.tenant_id]
      );
      return result.rows[0].screened && result.rows[0].clear
        && !caseRecord.fired_rule_code && Boolean(context.planPermitsAutoClear);
    }
    case 'human_block_decision':
    case 'senior_sign_off_refused':
    case 'case_abandoned_with_rationale':
      return Boolean(context.rationale);
    case 'requires_escalation':
      return Boolean(context.requiresEscalation);
    default:
      return false;
  }
}

async function assertSystemTransition(client, caseRecord, toState, context) {
  const transition = await findTransition(client, caseRecord.state, toState);
  if (!transition || transition.required_role) {
    throw new ApiError(409, 'IMMUTABLE_RULE', { rule: 'WORKFLOW_TRANSITION' });
  }
  if (!(await guardPasses(client, transition, caseRecord, context))) {
    throw new ApiError(409, 'IMMUTABLE_RULE', { rule: 'WORKFLOW_GUARD' });
  }
  return transition;
}

module.exports = { assertSystemTransition, findTransition, guardPasses };