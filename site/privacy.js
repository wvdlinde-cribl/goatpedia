/* Goatpedia privacy check for device requests, shared by the site's Request a device popup
   (browser), scripts/requests.mjs (Node, flags requests already on GitHub) and, later, the
   submit service. The repository is public, so a request must not carry real data.

   scan(text) → [{ kind, label, match }]   one finding per suspicious value, in text order
   mask(value) → a shortened form that is safe to show back to the requester

   What is refused: real IPv4/IPv6 and MAC addresses (the documentation ranges 192.0.2.0/24,
   198.51.100.0/24, 203.0.113.0/24 and 2001:db8::/32 are fine, as are 0.0.0.0 and loopback),
   email addresses outside example domains, internal hostnames (.local, .corp, .internal, …),
   cloud and API keys, private keys, JWTs, credentials in key=value form, bearer tokens and
   card numbers. A false positive (a four-part version number, say) is rewritten, not waved
   through: the requester can phrase it differently.                                        */
(function (root) {
  const DOC_V4 = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./, /^127\./, /^0\.0\.0\.0$/, /^255\.255\.255\.255$/];
  const EXAMPLE_MAIL = /@([\w-]+\.)*(example\.(com|org|net)|example|test|invalid|localhost)$/i;
  const PLACEHOLDER = /^(\*+|x+|<[^>]*>|\$\{[^}]*\}|\.\.\.|redacted|changeme|example|none|null|true|false|\[redacted\])$/i;

  const RULES = [
    { kind: 'private-key', label: 'a private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { kind: 'aws-key', label: 'an AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { kind: 'github-token', label: 'a GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
    { kind: 'slack-token', label: 'a Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
    { kind: 'api-key', label: 'an API key', re: /\b(?:sk|pk|rk)-(?:live-|test-|proj-)?[A-Za-z0-9_-]{20,}\b/g },
    { kind: 'jwt', label: 'a JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
    { kind: 'bearer', label: 'a bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
    {
      kind: 'credential', label: 'a password or secret',
      re: /\b(?:password|passwd|pwd|pass|secret|client_secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token)\s*["']?\s*[:=]\s*["']?([^\s"',;&]+)/gi,
      keep: (m) => !PLACEHOLDER.test(m[1]) && m[1].length >= 4,
    },
    { kind: 'email', label: 'an email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, keep: (m) => !EXAMPLE_MAIL.test(m[0]) },
    { kind: 'mac', label: 'a MAC address', re: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, keep: (m) => !/^(?:00[:-]){5}00$/i.test(m[0]) },
    {
      kind: 'ipv4', label: 'an IP address', re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
      keep: (m) => !DOC_V4.some((r) => r.test(m[0])),
    },
    {
      kind: 'ipv6', label: 'an IPv6 address', re: /(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){2,7}(?::|[0-9A-Fa-f]{1,4})(?:[0-9A-Fa-f]{1,4}:?)*(?![\w:])/g,
      keep: (m) => /[0-9a-f]{3,}/i.test(m[0]) && !/^2001:0?db8:/i.test(m[0]) && !/^::1?$/.test(m[0]) && !/^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(m[0]),
    },
    {
      kind: 'hostname', label: 'an internal hostname',
      re: /\b(?:[A-Za-z0-9-]+\.)+(?:local|corp|internal|intranet|lan|localdomain|home\.arpa|ad)\b/gi,
    },
    {
      // 15–16 digits starting 3–6 (Amex, Visa, Mastercard, Discover); epoch-ms timestamps start with 1.
      kind: 'card', label: 'a card number', re: /\b[3-6]\d{3}[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}\b/g,
      keep: (m) => luhn(m[0].replace(/\D/g, '')),
    },
  ];

  function luhn(d) {
    if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = +d[d.length - 1 - i];
      if (i % 2) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  }

  function scan(text) {
    const s = String(text || '');
    const found = [];
    const taken = [];
    for (const r of RULES) {
      for (const m of s.matchAll(r.re)) {
        if (r.keep && !r.keep(m)) continue;
        const from = m.index, to = m.index + m[0].length;
        // One finding per stretch of text: a token inside a credential is not reported twice.
        if (taken.some(([a, b]) => from < b && to > a)) continue;
        taken.push([from, to]);
        found.push({ kind: r.kind, label: r.label, match: m[0], at: from });
      }
    }
    return found.sort((a, b) => a.at - b.at).map(({ at, ...f }) => f);
  }

  function mask(value) {
    const v = String(value);
    // Only the start: enough to find the value again, never enough to read a secret's tail.
    return v.length <= 8 ? `${v.slice(0, 2)}…` : `${v.slice(0, 4)}…`;
  }

  const api = { scan, mask };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GoatpediaPrivacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
