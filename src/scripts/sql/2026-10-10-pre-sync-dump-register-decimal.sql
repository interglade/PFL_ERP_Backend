-- Run BEFORE the first backend boot that carries the receiving-links change
-- (docs/receiving-links-plan.md §7).
--
-- The entity changed dump_register.totalQty / totalDumpCost from integer to
-- numeric. TypeORM's synchronize does not convert a column type in place: it
-- DROPs the column and ADDs a new one, which erases the stored values.
-- Converting the columns here first makes synchronize see them as already
-- matching, so no data is lost. Safe to run more than once.
ALTER TABLE dump_register
  ALTER COLUMN "totalQty"      TYPE numeric(12,3) USING "totalQty"::numeric(12,3),
  ALTER COLUMN "totalDumpCost" TYPE numeric(12,2) USING "totalDumpCost"::numeric(12,2);
