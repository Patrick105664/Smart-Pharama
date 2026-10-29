-- db/schema.sql – SPM database schema
-- Run: mysql -u root -p < db/schema.sql
-- WARNING: This drops and recreates all tables!

CREATE DATABASE IF NOT EXISTS spm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE spm;

-- Drop in reverse dependency order
DROP TABLE IF EXISTS bill_items;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS returns;
DROP TABLE IF EXISTS batches;
DROP TABLE IF EXISTS medicines;
DROP TABLE IF EXISTS vendors;
DROP TABLE IF EXISTS racks;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS settings;

-- Users
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('owner','cashier') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Categories (fixed list, seeded)
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- Vendors
CREATE TABLE vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(100),
  address TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- Racks (fixed grid A1..E5)
CREATE TABLE racks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(5) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- Medicines
CREATE TABLE medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  barcode VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  category_id INT NOT NULL,
  manufacturer VARCHAR(200),
  gst_percent ENUM('0','5','12','18') NOT NULL DEFAULT '5',
  prescription_required TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB;

-- Batches
CREATE TABLE batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  batch_no VARCHAR(50) NOT NULL,
  expiry_date DATE NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  purchase_price DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  rack_id INT NOT NULL,
  vendor_id INT NOT NULL,
  is_flash_sale TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  received_date DATE NOT NULL DEFAULT (CURDATE()),
  UNIQUE KEY uq_medicine_batch (medicine_id, batch_no),
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (rack_id) REFERENCES racks(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  CHECK (qty >= 0)
) ENGINE=InnoDB;

-- Bills
CREATE TABLE bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_no VARCHAR(20) NOT NULL UNIQUE,
  customer_name VARCHAR(100),
  customer_phone VARCHAR(20),
  payment_mode ENUM('cash','upi','card') NOT NULL DEFAULT 'cash',
  taxable_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  gst_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Bill items (snapshots of medicine name and batch_no)
CREATE TABLE bill_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_id INT NOT NULL,
  batch_id INT NOT NULL,
  medicine_id INT NOT NULL,
  medicine_name VARCHAR(200) NOT NULL,
  batch_no VARCHAR(50) NOT NULL,
  qty INT NOT NULL,
  mrp DECIMAL(10,2) NOT NULL,
  discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  unit_price DECIMAL(10,2) NOT NULL,
  gst_percent DECIMAL(5,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  taxable_value DECIMAL(10,2) NOT NULL,
  gst_amount DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id),
  FOREIGN KEY (batch_id) REFERENCES batches(id),
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
) ENGINE=InnoDB;

-- Distributor returns
CREATE TABLE returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  vendor_id INT NOT NULL,
  qty INT NOT NULL,
  cost_value DECIMAL(10,2) NOT NULL,
  status ENUM('to_return','shipped','returned') NOT NULL DEFAULT 'to_return',
  refund_amount DECIMAL(10,2) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES batches(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB;

-- Settings (key-value)
CREATE TABLE settings (
  `key` VARCHAR(50) PRIMARY KEY,
  `value` VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- Default settings
INSERT INTO settings (`key`, `value`) VALUES ('low_stock_min', '10');
