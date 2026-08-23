// A marked region this tool owns inside a file a human also edits.
//
// `init` deliberately never touches an existing file, which leaves the most common finding —
// a bridge file that carries its own rules instead of importing AGENTS.md — unfixable by the
// tool. A managed block resolves that: everything outside the markers stays exactly as written,
// and the block can be added or refreshed without ever guessing at the user's content.
export const BEGIN = '<!-- agent-pipx:begin -->';
export const END = '<!-- agent-pipx:end -->';

const BLOCK = /<!-- agent-pipx:begin -->[\s\S]*?<!-- agent-pipx:end -->/g;

export function countBlocks(content) {
  return (content.match(BLOCK) || []).length;
}

export const hasBlock = (content) => countBlocks(content) > 0;

/** Append a managed block, leaving every existing byte in place. */
export function appendBlock(content, body) {
  const spacer = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${spacer}${BEGIN}\n${body}\n${END}\n`;
}
