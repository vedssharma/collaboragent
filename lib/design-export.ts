import type { DesignElement } from './types';

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

// Export only concrete colors: SVG paint URLs must never reference remote resources.
function color(value: string, fallback: string) {
  return /^#[\da-f]{3,8}$/i.test(value) ? value : fallback;
}

export function designBoardSvg(title: string, elements: DesignElement[]) {
  const shapes = elements.map((element, index) => {
    const x = element.x * 10, y = element.y * 7;
    const width = element.width * 10, height = element.height * 7;
    const fill = color(element.fill, '#ffffff'), stroke = color(element.stroke, '#25312d');
    const textColor = color(element.textColor, '#25312d');
    let shape: string;
    if (element.kind === 'connector') {
      shape = `<defs><marker id="arrow-${index}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7Z" fill="${stroke}"/></marker></defs><line x1="2" y1="${height / 2}" x2="${width - 8}" y2="${height / 2}" stroke="${stroke}" stroke-width="2" marker-end="url(#arrow-${index})"/>`;
    } else {
      shape = element.kind === 'circle'
        ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fill}" stroke="${stroke}"/>`
        : `<rect width="${width}" height="${height}" rx="6" fill="${fill}" stroke="${stroke}"/>`;
      const maxCharacters = Math.max(5, Math.floor((width - 16) / 8));
      const lines: string[] = [];
      for (const paragraph of element.text.split('\n')) {
        let line = '';
        for (const word of paragraph.split(/\s+/)) {
          if (line && line.length + word.length + 1 > maxCharacters) { lines.push(line); line = ''; }
          line += `${line ? ' ' : ''}${word}`;
        }
        lines.push(line);
      }
      shape += `<text fill="${textColor}" font-family="Arial, sans-serif" font-size="14" text-anchor="middle">${lines.map((line, i) => `<tspan x="${width / 2}" y="${height / 2 + (i - (lines.length - 1) / 2) * 18 + 5}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    }
    return `<g transform="translate(${x} ${y}) rotate(${element.rotation} ${width / 2} ${height / 2})">${shape}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" width="1000" height="700" role="img"><title>${escapeXml(title || 'Design board')}</title><rect width="1000" height="700" fill="#ffffff"/>${shapes}</svg>`;
}

export function downloadDesignBoard(title: string, elements: DesignElement[]) {
  const url = URL.createObjectURL(new Blob([designBoardSvg(title, elements)], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'design-board'}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
