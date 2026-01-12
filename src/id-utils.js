function parseIdsInput(input) {
  if (!input) {
    return [];
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const jsonFirstChar = trimmed[0];
  if (jsonFirstChar === '[' || jsonFirstChar === '{') {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map(item => {
            if (item && typeof item === 'object' && 'id' in item) {
              return item.id;
            }
            return item;
          })
          .map(value => (value === undefined || value === null ? '' : String(value)))
          .map(id => id.trim())
          .filter(Boolean);
      }
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.ids)) {
          return parsed.ids.map(String).map(id => id.trim()).filter(Boolean);
        }
        if (Array.isArray(parsed.emails)) {
          return parsed.emails
            .map(email => email && email.id)
            .map(id => (id ? String(id).trim() : ''))
            .filter(Boolean);
        }
      }
    } catch (_err) {
      // Fall through to plain parsing
    }
  }

  const cleaned = trimmed.replace(/^ids:\s*/i, '');
  return cleaned
    .split(/[\s,]+/)
    .map(id => id.trim())
    .filter(Boolean);
}

module.exports = {
  parseIdsInput,
};
