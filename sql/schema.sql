-- Mario Store POS schema for MySQL / MariaDB (XAMPP phpMyAdmin)
-- Create database `mario_store` first, then import this file.
CREATE DATABASE IF NOT EXISTS mario_store CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mario_store;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Owner','Tindero') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(220) NOT NULL,
  sku VARCHAR(100) NULL UNIQUE,
  category VARCHAR(160) NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock INT NOT NULL DEFAULT 5 CHECK (low_stock >= 0),
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales (
  id CHAR(36) PRIMARY KEY,
  receipt_no VARCHAR(100) NOT NULL UNIQUE,
  cashier_id CHAR(36) NULL,
  cashier_name VARCHAR(180) NOT NULL,
  note TEXT NOT NULL,
  total DECIMAL(12,2) NOT NULL CHECK (total >= 0),
  client_sale_id CHAR(36) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sales_cashier FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sales_created_at (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sale_items (
  id CHAR(36) PRIMARY KEY,
  sale_id CHAR(36) NOT NULL,
  product_id CHAR(36) NULL,
  product_name VARCHAR(220) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL CHECK (unit_price >= 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  line_total DECIMAL(12,2) NOT NULL CHECK (line_total >= 0),
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_sale_items_sale_id (sale_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_movements (
  id CHAR(36) PRIMARY KEY,
  product_id CHAR(36) NULL,
  type ENUM('INITIAL','SALE','RESTOCK','ADJUSTMENT') NOT NULL,
  quantity INT NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  user_id CHAR(36) NULL,
  client_movement_id CHAR(36) NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_stock_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_stock_movements_product_id (product_id),
  INDEX idx_stock_movements_created_at (created_at)
) ENGINE=InnoDB;
