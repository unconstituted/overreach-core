// npm run catalogue: index all content into content/catalogue.json. Fails on broken references.
import { CATALOGUE_FILE, writeCatalogue } from './content';

try {
  const cat = writeCatalogue('.');
  const count: Record<string, number> = {};
  for (const e of cat.entries) count[e.type] = (count[e.type] ?? 0) + 1;
  console.log(`${CATALOGUE_FILE}: ${Object.entries(count).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(', ')}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
