/** 从 definition 导出 describe.json，保证包里的自描述与代码一致。 */
import { writeFile } from 'node:fs/promises';
import { pastureDefinition } from '../src/definition.ts';

const describe = pastureDefinition.describe ?? { tools: [], events: [] };
await writeFile(
  new URL('../describe.json', import.meta.url),
  `${JSON.stringify(describe, null, 2)}\n`,
  'utf8',
);
console.log('wrote describe.json');
