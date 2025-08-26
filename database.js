
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

class EmailDatabase {
  constructor() {
    this.db = null;
    this.initDatabase();
  }

  initDatabase() {
    const dbPath = path.join(app.getPath('userData'), 'email_history.db');
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database');
        this.createTable();
      }
    });
  }

  createTable() {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS sent_emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        email_address TEXT NOT NULL,
        phone_number TEXT,
        company_address TEXT,
        business_website TEXT,
        email_subject TEXT,
        sent_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(email_address)
      )
    `;

    this.db.run(createTableQuery, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      } else {
        console.log('Email history table ready');
      }
    });
  }

  addSentEmail(emailData) {
    return new Promise((resolve, reject) => {
      const insertQuery = `
        INSERT OR REPLACE INTO sent_emails 
        (company_name, email_address, phone_number, company_address, business_website, email_subject)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      this.db.run(insertQuery, [
        emailData.companyName,
        emailData.email,
        emailData.phone,
        emailData.address,
        emailData.website,
        emailData.subject
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  getAllSentEmails() {
    return new Promise((resolve, reject) => {
      const selectQuery = `
        SELECT * FROM sent_emails 
        ORDER BY sent_date DESC
      `;

      this.db.all(selectQuery, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  checkIfEmailSent(emailAddress) {
    return new Promise((resolve, reject) => {
      const checkQuery = `
        SELECT COUNT(*) as count FROM sent_emails 
        WHERE email_address = ?
      `;

      this.db.get(checkQuery, [emailAddress], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count > 0);
        }
      });
    });
  }

  deleteEmailRecord(id) {
    return new Promise((resolve, reject) => {
      const deleteQuery = `DELETE FROM sent_emails WHERE id = ?`;

      this.db.run(deleteQuery, [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('Database connection closed');
        }
      });
    }
  }
}

module.exports = EmailDatabase;
