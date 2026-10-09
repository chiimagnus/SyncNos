// Preserve structured ChatGPT UI data without executing any provider expressions.
const richChartTypes: Record<string, string> = {
  bar: '柱状图',
  line: '折线图',
  pie: '饼图',
  scatter: '散点图',
};

function cellText(value: unknown): string {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function chartTable(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const chart = value as Record<string, any>;
  if (!Array.isArray(chart.data) || !chart.data.length) return '';
  if (!chart.data.every((row: unknown) => row && typeof row === 'object' && !Array.isArray(row))) return '';

  const columns: string[] = [];
  const add = (key: unknown) => {
    if (typeof key === 'string' && key && !columns.includes(key)) columns.push(key);
  };
  add(chart.xKey);
  add(chart.nameKey);
  add(chart.valueKey);
  if (Array.isArray(chart.series)) chart.series.forEach((entry: any) => add(entry?.dataKey));
  chart.data.forEach((row: Record<string, unknown>) => Object.keys(row).forEach(add));
  if (!columns.length) return '';

  const labels = columns.map((column) => {
    const series = Array.isArray(chart.series) ? chart.series.find((entry: any) => entry?.dataKey === column) : null;
    const label = typeof series?.label === 'string' ? series.label.trim() : '';
    return cellText(label && label !== column ? label + ' (' + column + ')' : column);
  });
  const type = richChartTypes[String(chart.chartType || '')] || '图表';
  const title = typeof chart.meta?.title === 'string' ? chart.meta.title.trim() : '';
  const heading = '**' + cellText(title || type + '数据') + '**' + (title ? '（' + type + '）' : '');
  return [
    heading,
    '',
    '| ' + labels.join(' | ') + ' |',
    '| ' + columns.map(() => '---').join(' | ') + ' |',
    ...chart.data.map(
      (row: Record<string, unknown>) => '| ' + columns.map((column) => cellText(row[column])).join(' | ') + ' |',
    ),
  ].join('\n');
}

function nativeDataTable(source: string): string {
  return source.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/g, (original, body: string) => {
    const rows = [...body.matchAll(/<table-row\b[^>]*>([\s\S]*?)<\/table-row>/g)]
      .map((match) =>
        [...match[1]!.matchAll(/<table-cell\b[^>]*>([\s\S]*?)<\/table-cell>/g)].map((cell) =>
          cellText(cell[1]!.replace(/<\/?(?:text|bold|italic|caption|code)\b[^>]*>/g, '').trim()),
        ),
      )
      .filter((cells) => cells.length > 0);
    if (!rows.length) return original;
    const columns = Math.max(...rows.map((row) => row.length));
    const line = (row: string[]) => '| ' + Array.from({ length: columns }, (_, i) => row[i] || '').join(' | ') + ' |';
    return (
      '\n\n' +
      [
        line(rows[0]!),
        '| ' + Array.from({ length: columns }, () => '---').join(' | ') + ' |',
        ...rows.slice(1).map(line),
      ].join('\n') +
      '\n\n'
    );
  });
}

function mapPointsTable(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return '';
  const points = value.filter((point) => point && typeof point === 'object' && !Array.isArray(point));
  if (!points.length) return '';
  return [
    '**地图地点数据**',
    '',
    '| 名称 | 地址或引用 | 纬度 | 经度 |',
    '| --- | --- | --- | --- |',
    ...points.map(
      (point) =>
        '| ' +
        [
          cellText(point.name || point.label || ''),
          cellText(point.address || point.ref || ''),
          cellText(point.lat),
          cellText(point.long),
        ].join(' | ') +
        ' |',
    ),
  ].join('\n');
}

function graphEquations(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return '';
  const expressions = value.map((entry) => (typeof entry?.latex === 'string' ? entry.latex : '')).filter(Boolean);
  return expressions.length
    ? '**函数图像数据**\n\n' + expressions.map((expression) => '- $' + expression + '$').join('\n')
    : '';
}

function extractJsonProp(component: string, prop: string): unknown {
  const opener = new RegExp('\\b' + prop + '\\s*=\\s*\\{', 'g');
  const match = opener.exec(component);
  if (!match) return null;
  let quoted = '';
  let level = 1;
  let end = -1;
  const start = match.index + match[0].length;
  for (let i = start; i < component.length; i += 1) {
    const char = component[i]!;
    if (quoted) {
      if (char === '\\') i += 1;
      else if (char === quoted) quoted = '';
      continue;
    }
    if (char === '"' || char === "'") quoted = char;
    else if (char === '{') level += 1;
    else if (char === '}') {
      level -= 1;
      if (!level) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(component.slice(start, end));
  } catch (_error) {
    return null;
  }
}

export function structuredRichUiMarkdown(source: string): string {
  const input = nativeDataTable(source);
  if (!/<(?:Chart|MapWidgetV2|Graph)\b/.test(input)) return input;
  let output = '';
  let offset = 0;
  while (offset < input.length) {
    const match = /<(Chart|MapWidgetV2|Graph)\b/g.exec(input.slice(offset));
    if (!match) break;
    const start = offset + match.index;
    output += input.slice(offset, start);
    let quoted = '';
    let level = 0;
    let end = -1;
    for (let i = start + match[0].length; i < input.length && i - start < 500_000; i += 1) {
      const char = input[i]!;
      if (quoted) {
        if (char === '\\') i += 1;
        else if (char === quoted) quoted = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quoted = char;
      } else if (char === '{') {
        level += 1;
      } else if (char === '}') {
        level -= 1;
      } else if (char === '/' && input[i + 1] === '>' && !level) {
        end = i + 2;
        break;
      }
    }
    if (end < 0) {
      output += match[0];
      offset = start + match[0].length;
      continue;
    }
    const component = input.slice(start, end);
    const table =
      match[1] === 'Chart'
        ? chartTable(extractJsonProp(component, 'content'))
        : match[1] === 'MapWidgetV2'
          ? mapPointsTable(extractJsonProp(component, 'points'))
          : graphEquations(extractJsonProp(component, 'expressions'));
    output += table ? '\n\n' + table + '\n\n' : component;
    offset = end;
  }
  return output + input.slice(offset);
}
