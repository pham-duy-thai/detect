// Exercise the actual account batch handler without a browser or real accounts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  const calls = [];
  const buttons = { "#bulk-approve": {}, "#bulk-reject": {} };
  const context = vm.createContext({
    window: { authRequest: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); } },
    document: { querySelector: selector => buttons[selector] || null },
    confirm: () => true, alert: message => { throw new Error(message); },
    setInterval, clearInterval
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/js/account.js"), "utf8"), context);
  vm.runInContext(`
    loadAccountUsers = async () => {};
    accountRows = [
      { id: "pending", status: "pending" },
      { id: "rejected", status: "rejected" },
      { id: "approved", status: "approved" }
    ];
    accountRows.forEach(user => selectedAccountIds.add(user.id));
  `, context);
  await vm.runInContext("bulkAccountDecision(true)", context);
  assert.deepEqual(calls.map(call => call.url), ["/auth/users/pending/approval", "/auth/users/rejected/approval"]);
  assert.ok(calls.every(call => call.body.approved === true));
  assert.equal(vm.runInContext("selectedAccountIds.has('pending')", context), false);
  calls.length = 0;
  vm.runInContext("accountRows.forEach(user => selectedAccountIds.add(user.id))", context);
  await vm.runInContext("bulkAccountDecision(false)", context);
  assert.deepEqual(calls.map(call => call.url), ["/auth/users/pending/approval"]);
  assert.equal(calls[0].body.approved, false);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/js/score-label.js"), "utf8"), context);
  const label = context.window.FallGuardScore.label;
  assert.equal(label({ confidence: 0.82, confidence_kind: "lstm_score" }), "Điểm LSTM 82%");
  assert.equal(label({ confidence: 0.82, confidence_kind: "pose_keypoint_quality" }), "Chất lượng keypoint 82%");
  assert.equal(label({ confidence: 0.82 }), "Điểm cũ: chưa rõ loại");
  console.log("PASS account batch approval/rejection eligibility and score labels");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
