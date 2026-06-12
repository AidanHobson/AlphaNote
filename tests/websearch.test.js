import { describe, it, expect } from 'vitest';
import { parseLiteResults } from '../server/lib/websearch.js';

// Mirrors lite.duckduckgo.com markup: single-quoted classes, uddg redirect URLs.
const HTML = `
<tr><td>1.&nbsp;</td><td>
  <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.mordorintelligence.com%2Findustry-reports%2Frobotics-market&rut=abc" class='result-link'>Robotics Market Size &amp; Industry Report, 2031</a>
</td></tr>
<tr><td></td><td class='result-snippet'>
  <b>Robotics</b> market size in 2026 is estimated at USD 88.27 billion, growing to USD 218.56 billion by 2031 at 19.86% <b>CAGR</b>.
</td></tr>
<tr><td>2.&nbsp;</td><td>
  <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.grandviewresearch.com%2Frobotics&rut=def" class='result-link'>Robotics Market Report</a>
</td></tr>
<tr><td></td><td class='result-snippet'>Projected to reach USD 169.8 billion by 2032.</td></tr>
`;

describe('parseLiteResults', () => {
  const results = parseLiteResults(HTML);

  it('pairs result links with snippets and decodes the real domain from uddg', () => {
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ domain: 'mordorintelligence.com' });
    expect(results[0].snippet).toContain('USD 88.27 billion');
    expect(results[0].snippet).toContain('19.86% CAGR');
    expect(results[0].snippet).not.toContain('<b>');
    expect(results[1].domain).toBe('grandviewresearch.com');
  });
  it('respects the count cap and tolerates junk input', () => {
    expect(parseLiteResults(HTML, 1)).toHaveLength(1);
    expect(parseLiteResults('')).toEqual([]);
    expect(parseLiteResults('<html>no results</html>')).toEqual([]);
  });
});
