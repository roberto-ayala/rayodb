-- Fixture for the MySQL driver tests. Mirrors the PostgreSQL fixture where
-- the engines overlap, so both drivers are exercised against comparable shape.
-- In MySQL a database *is* the schema, so `shop` plays the role `app` does there.

CREATE TABLE customers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    name        VARCHAR(255),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE orders (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    total       DECIMAL(10,2) NOT NULL,
    placed_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id)
        REFERENCES customers(id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX orders_customer_idx ON orders (customer_id);

CREATE VIEW customer_orders AS
    SELECT c.id, c.email, count(o.id) AS order_count
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id, c.email;

CREATE TRIGGER customers_touch BEFORE UPDATE ON customers
    FOR EACH ROW SET NEW.name = NEW.name;

CREATE FUNCTION order_count(cust INT) RETURNS BIGINT
    DETERMINISTIC READS SQL DATA
    RETURN (SELECT count(*) FROM orders WHERE customer_id = cust);

CREATE PROCEDURE purge_orders()
    DELETE FROM orders WHERE total < 0;

INSERT INTO customers (email, name)
    WITH RECURSIVE seq(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50
    )
    SELECT CONCAT('user', n, '@example.com'), CONCAT('User ', n) FROM seq;

INSERT INTO orders (customer_id, total)
    WITH RECURSIVE seq(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 200
    )
    SELECT (n % 50) + 1, (n % 97) + 0.5 FROM seq;

ANALYZE TABLE customers, orders;
