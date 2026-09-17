-- ---------------------------------------------------------------------------
-- Indexes on the local snapshot.
--
-- src_local.* is built by refresh-data.sh as `CREATE TABLE ... (LIKE src.X)`.
-- LIKE without INCLUDING INDEXES copies the columns and nothing else, so every
-- one of these tables was created without so much as a primary key — and every
-- join against them was a sequential scan, repeated once per row of whatever
-- was being computed.
--
-- The requests queue paid for this the most, because analytics.v_request_quote
-- derives item names and covering labs per request with correlated laterals.
-- Measured on a 15,974-request snapshot, before and after this file:
--
--   the queue's top 150 rows        722 ms  ->    8 ms
--   a text search across the queue  6,034 ms ->  105 ms
--   the whole view materialised    25,225 ms -> 3,609 ms
--
-- Nothing else changed. No view was rewritten, no query was touched.
--
-- Safe to run repeatedly: every statement is IF NOT EXISTS. TRUNCATE keeps
-- indexes, so the nightly rebuild does not drop them — but a brand new host
-- creates its tables from scratch, which is why refresh-data.sh applies this
-- file after creating them rather than relying on this having been run once.
--
-- These are OUR tables. The LabStack database is a read-only replica and is
-- not touched by anything here.
-- ---------------------------------------------------------------------------

-- Identity. Everything joins to these by id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_src_lab_id      ON src_local."Lab" (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_src_master_id   ON src_local."Master" (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_src_package_id  ON src_local."Package" (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_src_store_id    ON src_local."Store" (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_src_order_id    ON src_local."Order" (id);

-- Orders, by the three things anything ever asks about them.
CREATE INDEX IF NOT EXISTS idx_src_order_lab    ON src_local."Order" ("labId");
CREATE INDEX IF NOT EXISTS idx_src_order_store  ON src_local."Order" ("storeId");
CREATE INDEX IF NOT EXISTS idx_src_order_appt   ON src_local."Order" ("appointmentTime");

-- Requests. The id index already existed; the rest did not.
CREATE INDEX IF NOT EXISTS idx_src_request_order   ON src_local."Request" ("convertedOrderId");
CREATE INDEX IF NOT EXISTS idx_src_request_store   ON src_local."Request" ("storeId");
CREATE INDEX IF NOT EXISTS idx_src_request_created ON src_local."Request" ("createdAt" DESC);

-- Join tables. Both directions: a package's tests and a test's packages are
-- both asked for, and the high-water-mark top-up scans "B" every few minutes.
CREATE INDEX IF NOT EXISTS idx_src_m2p_b ON src_local."_MasterToPackage" ("B");
CREATE INDEX IF NOT EXISTS idx_src_m2p_a ON src_local."_MasterToPackage" ("A");
CREATE INDEX IF NOT EXISTS idx_src_p2r_b ON src_local."_PackageToRequest" ("B");
CREATE INDEX IF NOT EXISTS idx_src_p2r_a ON src_local."_PackageToRequest" ("A");
CREATE INDEX IF NOT EXISTS idx_src_m2r_b ON src_local."_MasterToRequest" ("B");
CREATE INDEX IF NOT EXISTS idx_src_m2r_a ON src_local."_MasterToRequest" ("A");

-- Catalogue reach: which store carries what, which lab carries what.
CREATE INDEX IF NOT EXISTS idx_src_pos_store ON src_local."PackagesOnStore" ("storeId", "packageId");
CREATE INDEX IF NOT EXISTS idx_src_pol_lab   ON src_local."PackagesOnLab" ("labId", "packageId");

-- The rate card. mv_lab_offering is built off these two columns.
CREATE INDEX IF NOT EXISTS idx_src_dos_master ON src_local."DOS" (master_id);
CREATE INDEX IF NOT EXISTS idx_src_dos_lab    ON src_local."DOS" (lab_id);

-- Geography is deliberately absent: src_local."PincodeToLatLong" is a view,
-- not a copied table, so there is nothing here to index.

-- Appointments, by the order they belong to.
CREATE INDEX IF NOT EXISTS idx_src_appt_order ON src_local."Appointment" (order_id);

-- The planner cannot use any of this until it knows the tables are not empty.
-- refresh-data.sh analyses after loading; this covers the first apply.
ANALYZE src_local."Lab";
ANALYZE src_local."Master";
ANALYZE src_local."Package";
ANALYZE src_local."Store";
ANALYZE src_local."Order";
ANALYZE src_local."Request";
ANALYZE src_local."_MasterToPackage";
ANALYZE src_local."_PackageToRequest";
ANALYZE src_local."_MasterToRequest";
ANALYZE src_local."PackagesOnStore";
ANALYZE src_local."PackagesOnLab";
ANALYZE src_local."DOS";
