'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { listStepExternalFileNames, siblingStepPath } = require('./step-assembly');

const FOOT_SNIPPET = `
ISO-10303-21;
HEADER;
FILE_NAME('FOOT.stp','2008-08-18T12:41:46+00:00',('none'),('none'),'CATIA','CATIA V5 STEP AP214','none');
ENDSEC;
DATA;
#33=DOCUMENT_FILE('FOOT_FRONT_000.stp','','',#34,'',$);
#73=DOCUMENT_FILE('FOOT_BACK_000.stp','','',#74,'',$);
#35=APPLIED_EXTERNAL_IDENTIFICATION_ASSIGNMENT('FOOT_FRONT_000.stp',#36,#32,(#33));
#75=APPLIED_EXTERNAL_IDENTIFICATION_ASSIGNMENT('FOOT_BACK_000.stp',#76,#72,(#73));
ENDSEC;
`;

describe('step-assembly', () => {
  test('lists unique sibling STEP documents from an assembly file', () => {
    assert.deepEqual(listStepExternalFileNames(FOOT_SNIPPET), [
      'FOOT_FRONT_000.stp',
      'FOOT_BACK_000.stp'
    ]);
  });

  test('ignores non-STEP document names', () => {
    const text = "#33=DOCUMENT_FILE('readme.txt','','',#34,'',$);";
    assert.deepEqual(listStepExternalFileNames(text), []);
  });

  test('resolves siblings next to a Windows path', () => {
    assert.equal(
      siblingStepPath('C:\\\\models\\\\FOOT.stp', 'FOOT_FRONT_000.stp'),
      'C:\\\\models\\\\FOOT_FRONT_000.stp'
    );
  });

  test('resolves siblings inside a zip entry path', () => {
    assert.equal(
      siblingStepPath('pack.zip::parts/FOOT.stp', 'FOOT_BACK_000.stp'),
      'pack.zip::parts/FOOT_BACK_000.stp'
    );
  });
});
