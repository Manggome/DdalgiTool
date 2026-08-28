/**
 * electron-builder 는 Developer ID 인증서가 없으면 서명을 건너뛴다.
 * 하지만 Apple Silicon 에서는 서명이 없는 앱이 아예 실행되지 않으므로 ad-hoc 서명을 직접 넣는다.
 *
 * 주의할 점 두 가지:
 *  - codesign --deep 으로 한 번에 서명하면 Electron 헬퍼가 필요한 entitlement 없이 서명되어
 *    앱이 실행 즉시 죽는다. 그래서 Electron 구조를 아는 @electron/osx-sign 을 쓴다.
 *  - ad-hoc 서명은 팀 ID가 없어서 바이너리마다 서로 다른 신원으로 취급된다.
 *    따라서 disable-library-validation 이 반드시 적용돼야 Electron Framework 를 불러올 수 있다.
 *    osx-sign 은 최상위 entitlements 옵션을 무시하므로 optionsForFile 로 넘긴다.
 *
 * 서명은 Electron fuse 적용 이후여야 하므로 afterPack 이 아니라 afterSign 단계에서 한다.
 *
 * Developer ID 인증서가 준비되면 electron-builder.yml 의 mac.identity 를 인증서 이름으로 바꾸고
 * 이 훅을 제거하면 정식 배포 서명이 된다.
 */
const path = require('node:path');

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const { signAsync } = require('@electron/osx-sign');
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const entitlements = path.join(__dirname, 'entitlements.mac.plist');

  console.log(`  • ad-hoc 서명  app=${appPath}`);
  await signAsync({
    app: appPath,
    platform: 'darwin',
    identity: '-', // ad-hoc
    identityValidation: false, // 키체인에서 '-' 를 찾지 않게 한다
    optionsForFile: () => ({ entitlements, hardenedRuntime: true }),
    // 번들된 claude 실행 파일은 Anthropic 서명을 그대로 두고 리소스로만 봉인한다.
    ignore: (filePath) => /claude-agent-sdk-darwin-[^/]+\/claude$/.test(filePath),
  });
  console.log('  • ad-hoc 서명 완료');
};
