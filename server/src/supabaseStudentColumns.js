function isMissingLoginPasswordColumn(error) {
  const msg = String((error && error.message) || '');
  return msg.includes('login_password')
    && (msg.includes('does not exist') || msg.includes('schema cache'));
}

function withLoginPasswordField(row) {
  return Object.assign({}, row, {
    login_password: row && row.login_password != null ? String(row.login_password) : '',
    sort_order: row && row.sort_order != null ? Number(row.sort_order) || 0 : 0
  });
}

/** unknown | missing | present */
let loginPasswordColumnState = 'unknown';

function isLoginPasswordColumnMissing() {
  if (loginPasswordColumnState === 'missing') return true;
  if (loginPasswordColumnState === 'present') return false;
  return null;
}

/**
 * Query students; falls back when migration 005 (login_password) is not applied yet.
 */
async function queryStudents(db, options) {
  const opts = options || {};
  const baseCols = 'id, name, class_id, status, login_id, sort_order';

  function applyFilters(q) {
    if (opts.classId) q = q.eq('class_id', String(opts.classId));
    if (opts.status) q = q.eq('status', String(opts.status));
    if (opts.studentId) q = q.eq('id', String(opts.studentId));
    if (opts.columns) return q.select(opts.columns);
    return q;
  }

  function selectWithPassword(q) {
    return applyFilters(q.from('students').select(baseCols + ', login_password'));
  }

  function selectWithoutPassword(q) {
    return applyFilters(q.from('students').select(baseCols));
  }

  function order(q) {
    if (opts.orderBy === 'sort_order' || !opts.orderBy) {
      return q.order('sort_order', { ascending: true }).order('name', { ascending: true });
    }
    if (opts.orderBy === 'name') {
      return q.order('name', { ascending: true });
    }
    return q.order(opts.orderBy);
  }

  if (loginPasswordColumnState === 'missing') {
    let q = order(selectWithoutPassword(db));
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'Database error.');
    return (data || []).map(function(row) {
      return withLoginPasswordField(Object.assign({}, row, { login_password: '' }));
    });
  }

  if (loginPasswordColumnState === 'present') {
    let q = order(selectWithPassword(db));
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'Database error.');
    return (data || []).map(withLoginPasswordField);
  }

  let q = order(selectWithPassword(db));
  let { data, error } = await q;
  if (!error) {
    loginPasswordColumnState = 'present';
    return (data || []).map(withLoginPasswordField);
  }
  if (!isMissingLoginPasswordColumn(error)) {
    throw new Error(error.message || 'Database error.');
  }

  loginPasswordColumnState = 'missing';
  q = order(selectWithoutPassword(db));
  ({ data, error } = await q);
  if (error) throw new Error(error.message || 'Database error.');
  return (data || []).map(function(row) {
    return withLoginPasswordField(Object.assign({}, row, { login_password: '' }));
  });
}

async function queryStudentsMaybeSingle(db, studentId) {
  const rows = await queryStudents(db, { studentId: studentId });
  return rows[0] || null;
}

module.exports = {
  isMissingLoginPasswordColumn,
  isLoginPasswordColumnMissing,
  withLoginPasswordField,
  queryStudents,
  queryStudentsMaybeSingle
};
