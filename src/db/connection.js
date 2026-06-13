const { execSync } = require('child_process');

class CoolifyDB {
  constructor(config = {}) {
    this.container = config.container || process.env.COOLIFY_DB_CONTAINER || 'coolify-db';
    this.database = config.database || process.env.COOLIFY_DB_NAME || 'coolify';
    this.user = config.user || process.env.COOLIFY_DB_USER || 'coolify';
  }

  async connect() {
    // Test connection
    try {
      this.query('SELECT 1 AS test');
    } catch (err) {
      throw new Error(`Cannot connect to database: ${err.message}`);
    }
    return this;
  }

  query(sql, params = []) {
    // Replace $1, $2, etc. with actual values (reverse order to handle $10 before $1)
    let finalSql = sql;
    for (let i = params.length - 1; i >= 0; i--) {
      const placeholder = `$${i + 1}`;
      const param = params[i];
      const value = param === null ? 'NULL' : `'${String(param).replace(/'/g, "''")}'`;
      finalSql = finalSql.split(placeholder).join(value);
    }

    // Escape for shell
    const escapedSql = finalSql.replace(/"/g, '\\"');

    // Use --csv for safe, quoted output. The old -A (pipe-delimited) mode broke
    // whenever a column value contained a pipe/comma/newline — e.g. the servers
    // `proxy` blob — shifting all later columns and making private_key_uuid
    // resolve to undefined (the "ssh_key@0 not found" bug). CSV quotes such
    // values, so parsing stays correct for every SELECT * query. (issues #3, #4)
    const cmd = `docker exec ${this.container} psql -U ${this.user} -d ${this.database} --csv -c "${escapedSql}"`;

    try {
      const result = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
      return this.parseResult(result, finalSql);
    } catch (err) {
      throw new Error(`Query failed: ${err.message}`);
    }
  }

  parseResult(output, sql) {
    // Check if it's a RETURNING query or SELECT
    const isSelect = sql.trim().toUpperCase().startsWith('SELECT') || sql.includes('RETURNING');

    if (!isSelect) {
      return { rows: [], rowCount: 0 };
    }

    const records = this.parseCsv(output);

    // Need at least header + one row
    if (records.length < 2) {
      return { rows: [], rowCount: 0 };
    }

    const headers = records[0].map(h => h.toLowerCase());

    // --csv has no "(N rows)" footer, but guard against a stray one just in case
    const dataRecords = records.slice(1).filter(r =>
      !(r.length === 1 && /^\(\d+ rows?\)$/.test(r[0]))
    );

    const rows = dataRecords.map(values => {
      const row = {};
      headers.forEach((col, i) => {
        const v = values[i];
        row[col] = (v === undefined || v === '') ? null : v;
      });
      return row;
    });

    return { rows, rowCount: rows.length };
  }

  // Minimal RFC-4180 CSV parser. Handles quoted fields containing commas,
  // newlines, pipes and escaped double-quotes (""). Robust to psql --csv output,
  // unlike the old line.split('|') which broke on data containing pipes.
  parseCsv(text) {
    const records = [];
    let field = '';
    let record = [];
    let inQuotes = false;
    let started = false; // does the current record have any content yet?

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true; started = true;
      } else if (c === ',') {
        record.push(field); field = ''; started = true;
      } else if (c === '\n') {
        record.push(field); records.push(record);
        field = ''; record = []; started = false;
      } else if (c === '\r') {
        // ignore CR (handles CRLF)
      } else {
        field += c; started = true;
      }
    }
    // flush a trailing record that wasn't newline-terminated
    if (started || field.length > 0 || record.length > 0) {
      record.push(field);
      records.push(record);
    }
    return records;
  }

  async disconnect() {
    // Nothing to disconnect with docker exec
  }

  // Generate UUID like Coolify does
  generateUuid() {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 26; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }
}

module.exports = CoolifyDB;
