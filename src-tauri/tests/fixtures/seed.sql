CREATE SCHEMA app;

CREATE TABLE app.customers (
    id          serial PRIMARY KEY,
    email       text NOT NULL UNIQUE,
    name        text,
    created_at  timestamptz DEFAULT now()
);

CREATE TABLE app.orders (
    id          serial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES app.customers(id) ON DELETE CASCADE ON UPDATE RESTRICT,
    total       numeric(10,2) NOT NULL CHECK (total >= 0),
    placed_at   timestamptz DEFAULT now()
);

CREATE INDEX orders_customer_idx ON app.orders (customer_id);

-- partitioned table, so load_tables exercises the partition branch
CREATE TABLE app.events (
    id      bigserial,
    at      timestamptz NOT NULL,
    kind    text
) PARTITION BY RANGE (at);

CREATE TABLE app.events_2025 PARTITION OF app.events
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE VIEW app.customer_orders AS
    SELECT c.id, c.email, count(o.id) AS order_count
    FROM app.customers c LEFT JOIN app.orders o ON o.customer_id = c.id
    GROUP BY c.id, c.email;

CREATE MATERIALIZED VIEW app.order_totals AS
    SELECT customer_id, sum(total) AS lifetime FROM app.orders GROUP BY customer_id;

CREATE SEQUENCE app.invoice_seq;

CREATE FUNCTION app.order_count(cust integer) RETURNS bigint
    LANGUAGE sql AS $$ SELECT count(*) FROM app.orders WHERE customer_id = cust $$;

CREATE FUNCTION app.touch_row() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

CREATE TRIGGER customers_touch BEFORE UPDATE ON app.customers
    FOR EACH ROW EXECUTE FUNCTION app.touch_row();

CREATE RULE orders_no_delete AS ON DELETE TO app.orders DO INSTEAD NOTHING;

ALTER TABLE app.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_self ON app.customers FOR SELECT USING (true);

CREATE TYPE app.status AS ENUM ('new', 'paid', 'shipped');

CREATE ROLE analyst;
GRANT USAGE ON SCHEMA app TO analyst;
GRANT SELECT ON app.customers TO analyst;
GRANT CONNECT ON DATABASE testdb TO analyst;

INSERT INTO app.customers (email, name)
    SELECT 'user' || i || '@example.com', 'User ' || i FROM generate_series(1, 500) i;

INSERT INTO app.orders (customer_id, total)
    SELECT (i % 500) + 1, (i % 97)::numeric + 0.5 FROM generate_series(1, 2000) i;

INSERT INTO app.events (at, kind)
    SELECT '2025-06-01'::timestamptz + (i || ' minutes')::interval, 'click'
    FROM generate_series(1, 100) i;

REFRESH MATERIALIZED VIEW app.order_totals;
ANALYZE;
