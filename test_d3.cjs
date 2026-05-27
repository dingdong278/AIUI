const fs = require('fs');
const d3 = require('d3');
const d = JSON.parse(fs.readFileSync('lore_relations.json', 'utf8'));
const nodes = d.nodes.map(d => Object.create(d));
const links = d.links.map(d => Object.create(d));
try {
  d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id));
  console.log("D3 simulation success");
} catch(e) {
  console.error(e);
}
