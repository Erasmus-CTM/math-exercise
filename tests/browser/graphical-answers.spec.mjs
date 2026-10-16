import { test, expect } from 'playwright/test';

async function exercise(page, url, label) {
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  const cell = page.locator(`.math-exercise-cell[data-label="${label}"]`);
  await cell.locator('.math-exercise-caption').click();
  const iframe = cell.locator('iframe');
  await expect(iframe).toBeVisible();
  await iframe.scrollIntoViewIfNeeded();
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.JXG && Object.values(JXG.boards).some(b => b.containerObj?.clientWidth > 0));
  return {cell, frame, iframe};
}

// Read the actual board geometry, then use real browser pointer gestures.
async function position(board, x, y) {
  const relative = await board.frame.evaluate(([x,y]) => {
    const b = Object.values(JXG.boards).find(b => b.containerObj?.clientWidth > 0);
    const rect = b.containerObj.getBoundingClientRect();
    const p = new JXG.Coords(JXG.COORDS_BY_USER, [x,y], b).scrCoords;
    return {x: rect.left+p[1], y: rect.top+p[2]};
  }, [x,y]);
  const box = await board.iframe.boundingBox();
  return {x:box.x+relative.x, y:box.y+relative.y};
}
async function drag(page, board, from, to) {
  const a=await position(board,...from),b=await position(board,...to);
  await page.mouse.move(a.x,a.y); await page.mouse.down();
  // JSXGraph throttles pointer moves. Pace the gesture across animation frames
  // so its final position is processed before releasing the pointer.
  for(let i=1;i<=16;i++){
    await board.frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.move(a.x+(b.x-a.x)*i/16,a.y+(b.y-a.y)*i/16);
  }
  await page.mouse.up();
}
async function correct(board) {
  await board.cell.locator('.math-check-btn').click();
  await expect(board.cell.locator('.math-feedback-area .math-fb-ok')).toBeVisible({timeout:120000});
}

test('graph editor creates vertices and edges, submits a tree, and clears it', async ({page}) => {
  const board=await exercise(page,'/graph-theory.html','jsxgraph-tree-construction');
  const points=[[-3,2],[-1.5,1],[0,2],[1.5,1],[3,2]];
  for(const point of points){const p=await position(board,...point);await page.mouse.click(p.x,p.y);}
  for(let i=0;i<4;i++)for(const point of [points[i],points[i+1]]){
    const p=await position(board,...point);await page.mouse.click(p.x,p.y);
  }
  await correct(board);
  await board.frame.getByRole('button',{name:'Clear graph',exact:true}).click();
  await board.cell.locator('.math-check-btn').click();
  await expect(board.cell.locator('.math-feedback-area')).toContainText('at least five vertices');
});

test('dragging fixed-x points submits the changed piecewise-linear curve', async ({page}) => {
  const board=await exercise(page,'/graphics-examples.html','ex-jsxgraph-pwl-monotonicity');
  for(let i=0;i<5;i++)await drag(page,board,[i/4,0.35],[i/4,0.15+0.15*i]);
  await correct(board);
});

test('the period handles submit the visible frame width', async ({page}) => {
  const board=await exercise(page,'/graphics-examples.html','jsxgraph-period-window');
  await drag(page,board,[0.8,-1.48],[1,-1.48]);
  await drag(page,board,[4.8,-1.48],[3.5,-1.48]);
  await expect.poll(() => board.frame.evaluate(() => rightX()-leftX())).toBeCloseTo(2.5,1);
  await correct(board);
});

test('a continuous pointer stroke produces and submits the fitted curve', async ({page}) => {
  const board=await exercise(page,'/graphics-examples.html','ex-jsxgraph-freehand-monotonicity');
  const start=await position(board,0.02,0.1);await page.mouse.move(start.x,start.y);await page.mouse.down();
  for(let i=1;i<=60;i++){
    const p=await position(board,0.02+0.96*i/60,0.1+0.8*i/60);
    await page.mouse.move(p.x,p.y);
  }
  await page.mouse.up();await correct(board);
});
