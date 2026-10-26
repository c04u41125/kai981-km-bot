-- Apply requested number-card pairing to brackets with no recorded results.
UPDATE brackets SET layout='numbered',version=version+1,updated_at=unixepoch() WHERE layout='seeded' AND results_json='{}';
