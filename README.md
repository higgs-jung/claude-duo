# cduo

두 개의 Claude Code 인스턴스를 동시에 실행하고 서로 협업할 수 있게 하는 웹 기반 터미널 오케스트레이션 도구입니다.

## 특징

- ✅ 듀얼 터미널 UI (xterm.js)
- ✅ Claude Code 인스턴스 간 자동 파이프라인
- ✅ Hook 기반 완료 감지
- ✅ 실시간 WebSocket 통신
- ✅ 협업 모드 컨텍스트 자동 주입
- ✅ 프로젝트별 설정 관리
- ✅ UI에서 턴 제한/쿨다운 조정 가능

## 빠른 시작

### 글로벌 설치

```bash
npm install -g cduo
```

### 프로젝트에서 사용

```bash
cd /path/to/your-project

# 1. 프로젝트 초기화 (.claude/ 설정 생성)
cduo init

# 2. 오케스트레이션 시작
cduo start
```

브라우저가 자동으로 열리고 두 개의 Claude Code 터미널이 실행됩니다.
`cduo start`는 현재 디렉토리의 `Stop` hook이 없으면 자동으로 추가합니다.
Claude Code CLI(`claude`)가 PATH에 있어야 각 터미널이 자동으로 시작됩니다.
브라우저 없이 쓰고 싶다면 `cduo start tmux`로 tmux pane 2개 모드를 사용할 수 있습니다.

## 설치 방법

### 방법 1: 글로벌 설치 (권장)

```bash
npm install -g cduo
```

어떤 프로젝트에서든 `cduo` 명령을 사용할 수 있습니다.

### 방법 2: 프로젝트 의존성

```bash
cd /path/to/your-project
npm install --save-dev cduo

# package.json에 스크립트 추가
{
  "scripts": {
    "orchestrate": "cduo start"
  }
}

npm run orchestrate
```

### 방법 3: npx (설치 없이)

```bash
npx cduo init
npx cduo start
```

## 명령어

### `cduo init`

현재 디렉토리에 설정 파일을 생성합니다:

- `.claude/settings.local.json` - Hook 설정 (자동 완료 감지)
- `CLAUDE.md` - 협업 모드 컨텍스트 (프로젝트 루트)

```bash
cduo init
```

### `cduo start`

현재 디렉토리를 작업 경로로 오케스트레이션 서버를 시작합니다:

```bash
cduo start

# 커스텀 포트
PORT=8080 cduo start

# Claude를 풀액세스 모드로 시작
cduo start --full-access

# Claude를 YOLO 모드로 시작
cduo start yolo

# 브라우저 없이 tmux pane 2개로 시작
cduo start tmux

# tmux pane 2개 + YOLO 모드
cduo start tmux yolo
```

실행 전에 현재 디렉토리의 `.claude/settings.local.json`을 확인하고, orchestration용 `Stop` hook이 없으면 자동으로 병합합니다.
`--full-access`를 사용하면 각 터미널이 `claude --permission-mode bypassPermissions`로 시작됩니다.
`yolo`를 사용하면 각 터미널이 `claude --dangerously-skip-permissions`로 시작됩니다.
`tmux`를 사용하면 브라우저 대신 tmux 세션에 pane 2개를 만들고 같은 자동 전달 로직을 사용합니다.
`tmux`가 설치되어 있지 않으면 설치 명령을 안내하고 종료합니다.

### `cduo backup`

현재 디렉토리의 orchestration 관련 파일을 백업합니다:

- `.claude/settings.local.json`
- `CLAUDE.md`

```bash
cduo backup
```

백업 파일은 `.cduo/backups/<timestamp>/` 아래에 저장됩니다.

### `cduo uninstall`

현재 디렉토리에서 orchestration 설정을 제거합니다:

- `.claude/settings.local.json`의 `Stop` hook 제거
- `CLAUDE.md`에 prepend된 orchestration 컨텍스트 제거

```bash
cduo uninstall
```

`uninstall`은 변경 전에 현재 상태를 `.cduo/backups/<timestamp>/`에 자동 백업합니다.

## 프로젝트 구조

```
your-project/
├── .cduo/
│   └── backups/            # cduo backup / uninstall 자동 백업
├── .claude/
│   └── settings.local.json  # Hook 설정 (cduo init으로 생성)
├── CLAUDE.md                # 협업 컨텍스트 (cduo init으로 생성)
└── ... (your project files)
```

tmux 모드는 현재 디렉토리를 기준으로 새 tmux 세션을 만들고, 각 pane에 Claude를 실행합니다.

## CLAUDE.md의 역할

`cduo init`으로 생성되는 `CLAUDE.md` 파일은 Claude Code가 시작될 때 자동으로 읽는 시스템 프롬프트입니다. 이 파일은:

- 다른 Claude 인스턴스와 협업 중임을 알립니다
- 간결하고 명확한 응답을 권장합니다
- 출력이 다른 인스턴스로 전달됨을 설명합니다
- 효과적인 협업 패턴을 제시합니다

## 사용 시나리오

### 시나리오 1: 풀스택 개발

```bash
cd ~/projects/my-app
cduo init
cduo start
```

- **Terminal A**: 백엔드 API 개발
- **Terminal B**: 프론트엔드 컴포넌트 개발
- A의 API 스펙이 자동으로 B에 전달되어 즉시 연동 작업 가능

### 시나리오 2: 코드 리뷰 & 개선

```bash
cd ~/projects/existing-project
cduo init
cduo start
```

- **Terminal A**: 기능 구현
- **Terminal B**: 코드 리뷰 및 개선 제안
- 상호 피드백을 통한 반복 개선

### 시나리오 3: 테스트 주도 개발

- **Terminal A**: 테스트 코드 작성
- **Terminal B**: 테스트를 통과하는 구현 작성

## 설정

### UI 컨트롤 (브라우저 상단)

웹 UI 상단에서 실시간으로 동작을 조정할 수 있습니다:

**Turn Limit (턴 제한)**
- 체크박스를 해제하면 무제한 교환 가능
- 켜면 Max Turns 값까지만 자동 교환

**Max Turns (최대 턴 수)**
- 1-100 사이 값 입력 (기본값: 10)
- A→B→A→B... 형태로 몇 번까지 주고받을지 제한
- 현재 턴 수가 60% 넘으면 주황색, 80% 넘으면 빨간색 표시

**Cooldown (쿨다운)**
- 메시지 간 최소 대기 시간 (ms 단위, 기본값: 3000)
- 0-10000ms 사이 값 입력
- 너무 빠른 연속 전송 방지

**Turn Counter (턴 카운터)**
- 현재 진행된 턴 수 / 최대 턴 수 표시
- 색상으로 진행률 시각화 (초록→주황→빨강)

### 포트 설정

기본 포트는 `53333`입니다 (충돌 가능성 최소화를 위한 높은 포트 번호).

**왜 53333?**
- 일반적인 개발 서버들이 사용하지 않는 범위
- 동적/사설 포트 범위 (49152-65535)에 속함
- 다른 프로세스와 충돌 가능성이 매우 낮음

**자동 포트 찾기:**
- 53333 포트가 사용 중이면 자동으로 53334, 53335... 순서로 사용 가능한 포트를 찾습니다 (최대 10번 시도)
- 실제 사용된 포트는 콘솔에 표시됩니다
- Hook도 자동으로 실제 포트를 사용합니다

**커스텀 포트로 변경:**
```bash
PORT=8080 cduo start

# tmux 모드에서도 동일
PORT=8080 cduo start tmux
```

**포트 충돌 해결:**
```bash
# 포트 사용 중인 프로세스 확인 (macOS/Linux)
lsof -i :53333

# 프로세스 종료
kill -9 <PID>
```

### Hook 설정 커스터마이징

`.claude/settings.local.json`을 수정:

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  },
  "hooks": {
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "HOOK_PORT=${ORCHESTRATION_PORT:-53333} && curl -X POST http://localhost:$HOOK_PORT/hook -H 'Content-Type: application/json' -d '{\"type\":\"stop\",\"terminal_id\":\"'$TERMINAL_ID'\"}' &"
          }
        ]
      }
    ]
  }
}
```

이미 다른 설정이 들어 있는 경우에도 `cduo start`와 `cduo init`은 `Stop` hook만 병합합니다.

### 딜레이 조정

타이밍 이슈가 있는 경우 `public/client.js`에서 딜레이 조정 가능:

```javascript
setTimeout(() => {
  // ...
}, 1500);  // ms 단위
```

## 개발 & 기여

### 로컬 개발

```bash
git clone https://github.com/higgs-jung/cduo.git
cd cduo
npm install
npm start
```

### 보안/배포 참고

- HTTPS로 페이지가 제공될 때 WebSocket은 자동으로 `wss://`를 사용합니다.
- 포트는 53333부터 자동으로 가용 포트를 탐색하며, 훅은 실제 사용 포트를(`ORCHESTRATION_PORT`) 따라갑니다.
- 높은 포트 번호(53333)를 사용하여 일반적인 개발 서버와의 충돌을 방지합니다.

### 프로젝트 구조

```
cduo/
├── bin/
│   └── cli.js              # CLI 진입점 (init, start)
├── public/
│   ├── index.html          # 듀얼 터미널 UI
│   └── client.js           # WebSocket 클라이언트 + 자동 파이프라인
├── .claude/
│   └── settings.template.json   # Hook 설정 템플릿
├── claude.md               # 협업 컨텍스트 템플릿 (init 시 CLAUDE.md로 복사)
├── server.js               # Express + WebSocket 서버
└── package.json
```

## 트러블슈팅

### 메시지가 전송되지 않음

- 브라우저 개발자 도구 콘솔 확인
- `Hook detected completion` 로그 확인
- 서버 로그에서 `[CR:true]` 확인

### Hook이 발동하지 않음

- `.claude/settings.local.json`의 Stop hook 확인
- `TERMINAL_ID` 환경 변수 확인
- `curl` 명령이 성공하는지 수동 테스트

### ANSI 코드가 섞여 나옴

- `client.js`의 `stripAnsi()` 함수 확인
- status indicator 목록 업데이트

### 터미널이 다른 디렉토리에서 실행됨

`cduo start`를 실행한 디렉토리가 터미널의 작업 디렉토리가 됩니다. 올바른 프로젝트 폴더에서 실행했는지 확인하세요.

### tmux가 설치되어 있지 않음

- macOS(Homebrew): `brew install tmux`
- Ubuntu/Debian: `sudo apt install tmux`
- Fedora: `sudo dnf install tmux`
- Arch: `sudo pacman -S tmux`

## 업데이트

### 글로벌 설치 업데이트

```bash
# 최신 버전으로 업데이트
npm install -g cduo@latest

# 또는
npm update -g cduo

# 설치된 버전 확인
npm list -g cduo
```

### 프로젝트 의존성 업데이트

```bash
# package.json에 명시된 경우
npm update cduo

# 또는 최신 버전 강제 설치
npm install cduo@latest
```

### 주요 변경사항 확인

- [GitHub Releases](https://github.com/higgs-jung/cduo/releases)
- [CHANGELOG](https://github.com/higgs-jung/cduo/blob/main/CHANGELOG.md)

## 라이선스

MIT
