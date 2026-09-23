import { instance } from '@viz-js/viz';
import { readFile, writeFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('./ontology.json', import.meta.url), 'utf8'));
const groups = [
  { name: 'Arithmetic foundations', color: '#43605b', fill: '#eff4f1', ids: [1,2,3,26] },
  { name: 'Fractions & decimals', color: '#257a8a', fill: '#edf8fa', ids: [5,6,7,8,9,10,11] },
  { name: 'Signed numbers', color: '#5579aa', fill: '#f0f5fd', ids: [12,13,14,15] },
  { name: 'Ratios & percentages', color: '#a27027', fill: '#fff7e6', ids: [16,17,18,19,20,39] },
  { name: 'Number structure & properties', color: '#866753', fill: '#f8f1ec', ids: [4,21,22,23,24,25,33] },
  { name: 'Expressions & equations', color: '#7967a3', fill: '#f5f1fc', ids: [27,28,29,30,31,32,34,35,36] },
  { name: 'Coordinates & functions', color: '#3a8470', fill: '#eef8f3', ids: [37,38,40,41,42,43,44,45] },
  { name: 'Systems of equations', color: '#b05e62', fill: '#fff1f1', ids: [46,47,48] }
];
const escape = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function wrap(text, limit=27) {
  const lines=[''];
  for (const word of text.split(' ')) {
    if (lines.at(-1).length + word.length > limit && lines.at(-1)) lines.push(word);
    else lines[lines.length-1] += (lines.at(-1) ? ' ' : '') + word;
  }
  return lines;
}
const ids = new Set(data.nodes.map(n=>n.id));
if(ids.size!==48 || data.edges.length!==80) throw Error('Unexpected ontology counts');
const visited=new Set(), active=new Set();
function visit(id){
  if(active.has(id))throw Error('Cycle: '+id);
  if(visited.has(id))return;
  active.add(id);
  const node=data.nodes.find(n=>n.id===id);
  for(const p of node.prerequisites){if(!ids.has(p))throw Error('Unknown prerequisite');visit(p);}
  active.delete(id);visited.add(id);
}
data.nodes.forEach(n=>visit(n.id));
for(const n of data.nodes){
  n.group=groups.find(g=>g.ids.includes(Number(n.id.slice(-3)))).name;
  const incoming=data.edges.filter(e=>e.target===n.id).map(e=>e.source).sort();
  if(JSON.stringify(incoming)!==JSON.stringify([...n.prerequisites].sort())) throw Error('Prerequisite mismatch');
}
const nodeLines = data.nodes.map(n=>{
  const g=groups.find(g=>g.name===n.group);
  const label=`<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="3"><TR><TD><FONT POINT-SIZE="9" COLOR="${g.color}">${n.id}</FONT></TD></TR><TR><TD><B>${wrap(n.name).map(escape).join('<BR/>')}</B></TD></TR><TR><TD><FONT POINT-SIZE="9" COLOR="#64736e">Grades ${escape(n.grade)}</FONT></TD></TR></TABLE>`;
  return `${n.id} [id="${n.id}" color="${g.color}" fillcolor="${g.fill}" label=<${label}> tooltip="${escape(n.definition)}"];`;
});
const dot=`digraph Math {
  graph [rankdir=TB bgcolor="transparent" pad="0.25" nodesep="0.30" ranksep="0.42" splines=spline outputorder=edgesfirst];
  node [shape=box style="rounded,filled" fontname="Arial" fontsize=12 fontcolor="#253b36" penwidth=1.2 margin="0.10,0.05"];
  edge [color="#b2bfbb" penwidth=1.1 arrowsize=0.65];
  ${nodeLines.join('\n')}
  ${data.edges.map(e=>`${e.source} -> ${e.target} [id="edge_${e.source}_${e.target}" tooltip="${escape(e.rationale)}"];`).join('\n')}
}`;
const viz=await instance();
const svg=viz.renderString(dot,{format:'svg',engine:'dot'}).replace(/<\?xml[^>]*>\s*/,'').replace(/<!DOCTYPE[\s\S]*?>\s*/,'');
const template=await readFile(new URL('./template.html',import.meta.url),'utf8');
await writeFile(new URL('./index.html',import.meta.url),template.replace('<!-- GRAPH -->',svg).replace('/* ONTOLOGY */',`const data = ${JSON.stringify(data)}; const groups = ${JSON.stringify(groups)};`));
const viewBox=svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const width=viewBox[2], height=viewBox[3];
const legend=groups.map((g,i)=>{const col=i%4,row=Math.floor(i/4);return `<g transform="translate(${24+col*(width-48)/4},${97+row*24})"><circle r="4" cy="-3" fill="${g.color}"/><text x="10" font-size="11">${escape(g.name)}</text></g>`;}).join('');
const staticSVG=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height+170}" viewBox="0 0 ${width} ${height+170}" role="img" aria-labelledby="title description"><title id="title">Mathematics prerequisite graph</title><desc id="description">48 concepts and 80 directed prerequisite relationships, progressing from arithmetic foundations to introductory algebra.</desc><rect width="100%" height="100%" fill="#fafbf8"/><g font-family="Arial, sans-serif" fill="#243d36"><text x="24" y="34" font-size="25" font-weight="bold">Mathematics, connected.</text><text x="24" y="59" font-size="12">48 concepts · 80 relationships · Grades 5–9 and earlier foundations</text>${legend}<text x="24" y="151" font-size="11">Read top to bottom: prerequisite → dependent concept. Every arrow is PREREQUISITE_OF. Grade bands are approximate.</text></g>${svg.replace('<svg ', '<svg y="165" ' )}</svg>`;
await writeFile(new URL('./mathematics-ontology.svg',import.meta.url),staticSVG);
await writeFile(new URL('./mathematics-ontology.dot',import.meta.url),dot);
console.log(`Built interactive HTML and SVG: ${data.nodes.length} nodes, ${data.edges.length} edges; acyclic and consistent.`);
