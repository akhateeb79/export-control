INSERT INTO list_sources (code, authority, name, source_url, format, is_blocking, sync_cron) VALUES
  ('OFAC_SDN', 'OFAC', 'Specially Designated Nationals and Blocked Persons List', 'https://www.treasury.gov/ofac/downloads/sdn.xml', 'XML', TRUE, '0 2 * * *'),
  ('OFAC_CONSOLIDATED', 'OFAC', 'Consolidated Sanctions List', 'https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml', 'XML', TRUE, '0 2 * * *'),
  ('BIS_ENTITY', 'BIS', 'Entity List', 'https://www.bis.gov/entity-list', 'CSV', TRUE, '15 2 * * *'),
  ('BIS_DPL', 'BIS', 'Denied Persons List', 'https://media.bis.gov/sites/default/files/dpl_04142026.csv', 'CSV', TRUE, '30 2 * * *'),
  ('BIS_UVL', 'BIS', 'Unverified List', 'https://www.bis.gov/uvl', 'CSV', FALSE, '45 2 * * *')
ON CONFLICT (code) DO NOTHING;