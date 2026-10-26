import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
test('Jira input rejects shell syntax and other projects before fetching',()=>{
  for (const key of ['ABC-1','SDT-0','SDT-1;echo bad','SDT-1\nbranch=main','']) {
    const result = spawnSync(process.execPath,['.github/scripts/jira-ticket.mjs'],{env:{...process.env,ISSUE_KEY:key},encoding:'utf8'});
    assert.notEqual(result.status,0); assert.match(result.stderr,/Expected an SDT issue key/);
  }
});
test('deployment remains manual and pinned to a commit',()=>{
  const workflow = readFileSync('.github/workflows/deploy.yml','utf8');
  assert.match(workflow,/workflow_dispatch:/); assert.doesNotMatch(workflow,/\n  (push|pull_request|repository_dispatch):/);
  assert.match(workflow,/environment: production/); assert.match(workflow,/merge-base --is-ancestor/);
  assert.match(readFileSync('render.yaml','utf8'),/autoDeployTrigger: 'off'/);
});
