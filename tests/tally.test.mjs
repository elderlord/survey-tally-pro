// 실행: node --test
// index.html에서 id="tally-logic" 블록만 꺼내 시험한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/<script id="tally-logic">([\s\S]*?)<\/script>/);
assert.ok(match, 'index.html에 tally-logic 블록이 있어야 한다');
const context = {};
vm.runInNewContext(match[1], context);
// vm 안에서 만든 배열·객체는 프로토타입이 달라 deepStrictEqual이 실패하므로 JSON으로 옮긴다.
const tally = (text) => JSON.parse(JSON.stringify(context.SurveyTally.tally(text)));

// 문항 이름 목록과 문항 값 줄들로 붙여넣을 글을 만든다. 첫 열에는 응답번호를 붙인다.
function sheet(names, rows) {
  const header = ['번호', ...names].join('\t');
  const body = rows.map((cells, i) => [String(i + 1), ...cells].join('\t'));
  return [header, ...body].join('\n');
}

// 문항 하나짜리 열에 값을 넣고 그 문항의 결과를 돌려준다.
function one(values) {
  const result = tally(sheet(['문항'], values.map((v) => [v])));
  assert.equal(result.questions.length, 1);
  return result.questions[0];
}

function pick(q) {
  return { valid: q.valid, blank: q.blank, excluded: q.excluded, average: q.average };
}

// 문항마다 유효 + 빈 응답 + 제외 = 전체 응답 수
function assertSums(result) {
  for (const q of result.questions) {
    assert.equal(q.valid + q.blank + q.excluded, result.responseCount, `문항 "${q.name}" 합계`);
  }
}

test('사례1: 1, 2, 3, 4, 5', () => {
  assert.deepEqual(pick(one(['1', '2', '3', '4', '5'])), { valid: 5, blank: 0, excluded: 0, average: '3.00' });
});

test('사례2: 5, (빈칸), 3', () => {
  assert.deepEqual(pick(one(['5', '', '3'])), { valid: 2, blank: 1, excluded: 0, average: '4.00' });
});

test('사례3: 4, 6, 0, 4점, 3', () => {
  assert.deepEqual(pick(one(['4', '6', '0', '4점', '3'])), { valid: 2, blank: 0, excluded: 3, average: '3.50' });
});

test('사례4: (빈칸) 세 개 → 평균 "-"', () => {
  assert.deepEqual(pick(one(['', '', ''])), { valid: 0, blank: 3, excluded: 0, average: '-' });
});

test('사례4 보충: 공백만 있는 칸도 빈 응답', () => {
  assert.deepEqual(pick(one([' ', '  ', '　'])), { valid: 0, blank: 3, excluded: 0, average: '-' });
});

test('사례5: " 4 "는 유효, "4.0"과 전각 "５"는 제외', () => {
  assert.deepEqual(pick(one([' 4 ', '4.0', '５'])), { valid: 1, blank: 0, excluded: 2, average: '4.00' });
});

test('사례6: 평균 3.125는 3.13으로 반올림', () => {
  assert.equal(one(['3', '3', '3', '3', '3', '3', '3', '4']).average, '3.13');
});

test('사례6 보충: 반올림 경계 여러 개', () => {
  assert.equal(one(['1', '2', '2']).average, '1.67');   // 1.666…
  assert.equal(one(['1', '1', '2']).average, '1.33');   // 1.333…
  assert.equal(one(['5']).average, '5.00');
  assert.equal(one(['1', '2', '2', '2', '2', '2', '2', '2']).average, '1.88'); // 1.875
});

test('사례7: 칸이 모자란 줄은 모자란 칸을 빈 응답으로 센다', () => {
  const text = ['번호\tA\tB\tC', '1\t5\t4\t3', '2\t4'].join('\n');
  const result = tally(text);
  assert.equal(result.responseCount, 2);
  assert.deepEqual(result.questions.map(pick), [
    { valid: 2, blank: 0, excluded: 0, average: '4.50' },
    { valid: 1, blank: 1, excluded: 0, average: '4.00' },
    { valid: 1, blank: 1, excluded: 0, average: '3.00' },
  ]);
  assertSums(result);
});

test('사례8: 끝에 붙은 빈 줄은 빈 응답을 늘리지 않는다', () => {
  const base = sheet(['A', 'B'], [['5', '4'], ['3', '']]);
  for (const tail of ['\n', '\r\n', '\n\n', '\t\t\n', '\n\t\t\n']) {
    const result = tally(base + tail);
    assert.equal(result.responseCount, 2, JSON.stringify(tail));
    assert.deepEqual(result.questions.map((q) => q.blank), [0, 1]);
    assertSums(result);
  }
});

test('사례9: 첫 열(응답번호)은 결과에 나오지 않는다', () => {
  const result = tally(sheet(['만족도'], [['4'], ['5'], ['3'], ['2'], ['1']]));
  assert.deepEqual(result.questions.map((q) => q.name), ['만족도']);
  assert.equal(result.questions[0].valid, 5);
});

test('사례10: 남는 칸은 버린다', () => {
  const text = ['번호\tA\tB', '1\t4\t3\t5', '2\t2\t1'].join('\n');
  const result = tally(text);
  assert.deepEqual(result.questions.map((q) => q.name), ['A', 'B']);
  assert.deepEqual(result.questions.map(pick), [
    { valid: 2, blank: 0, excluded: 0, average: '3.00' },
    { valid: 2, blank: 0, excluded: 0, average: '2.00' },
  ]);
  assertSums(result);
});

test('합계 기준: 문항 10개, 섞인 값에서도 유효 + 빈 + 제외 = 전체 응답 수', () => {
  const names = Array.from({ length: 10 }, (_, i) => `Q${i + 1}`);
  const pool = ['1', '2', '3', '4', '5', '', ' ', '6', '0', '4.0', '좋음', ' 3 '];
  const rows = Array.from({ length: 37 }, (_, r) => {
    const len = 1 + ((r * 7) % 12); // 모자라거나 남는 줄 섞기
    return Array.from({ length: len }, (_, c) => pool[(r * 5 + c * 3) % pool.length]);
  });
  const result = tally(sheet(names, rows) + '\r\n');
  assert.equal(result.questions.length, 10);
  assert.equal(result.responseCount, 37);
  assertSums(result);
});

test('엑셀 줄바꿈(CRLF)도 같은 결과', () => {
  const lf = sheet(['A', 'B'], [['5', '4'], ['', 'x']]);
  assert.deepEqual(tally(lf.replace(/\n/g, '\r\n')), tally(lf));
});

test('빈 입력은 null, 머리글만 있으면 응답 0', () => {
  assert.equal(tally(''), null);
  assert.equal(tally('\n \n'), null);
  const result = tally('번호\tA\tB');
  assert.equal(result.responseCount, 0);
  assert.deepEqual(result.questions.map(pick), [
    { valid: 0, blank: 0, excluded: 0, average: '-' },
    { valid: 0, blank: 0, excluded: 0, average: '-' },
  ]);
});
