async function runBatched(items, worker, batchSize) {
  batchSize = batchSize || 5;
  const list = items.slice();
  for (let i = 0; i < list.length; i += batchSize) {
    const chunk = list.slice(i, i + batchSize);
    await Promise.all(chunk.map(worker));
  }
}

module.exports = { runBatched };
