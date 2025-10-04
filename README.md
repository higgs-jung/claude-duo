# Claude Code Orchestration

두 개의 Claude Code 인스턴스를 동시에 실행하고 서로 협업할 수 있게 하는 웹 기반 터미널 오케스트레이션 도구입니다.

## 특징

- ✅ 듀얼 터미널 UI (xterm.js)
- ✅ Claude Code 인스턴스 간 자동 파이프라인
- ✅ Hook 기반 완료 감지
- ✅ 실시간 WebSocket 통신
- ✅ 협업 모드 컨텍스트 자동 주입
- ✅ 프로젝트별 설정 관리

## 빠른 시작

### 글로벌 설치

```bash
npm install -g claude-duo
```

### 프로젝트에서 사용

```bash
cd /path/to/your-project

# 1. 프로젝트 초기화 (.claude/ 설정 생성)
claude-duo init

# 2. 오케스트레이션 시작
claude-duo start
```

브라우저가 자동으로 열리고 두 개의 Claude Code 터미널이 실행됩니다.

## 설치 방법

### 방법 1: 글로벌 설치 (권장)

```bash
npm install -g claude-duo
```

어떤 프로젝트에서든 `claude-duo` 명령을 사용할 수 있습니다.

### 방법 2: 프로젝트 의존성

```bash
cd /path/to/your-project
npm install --save-dev claude-duo

# package.json에 스크립트 추가
{
  "scripts": {
    "orchestrate": "claude-duo start"
  }
}

npm run orchestrate
```

### 방법 3: npx (설치 없이)

```bash
npx claude-duo init
npx claude-duo start
```

## 명령어

### `claude-duo init`

현재 디렉토리에 `.claude/` 설정 파일을 생성합니다:

- `.claude/settings.local.json` - Hook 설정 (자동 완료 감지)
- `.claude/claude.md` - 협업 모드 컨텍스트

```bash
claude-duo init
```

### `claude-duo start`

현재 디렉토리를 작업 경로로 오케스트레이션 서버를 시작합니다:

```bash
claude-duo start

# 커스텀 포트
PORT=8080 claude-duo start
```

## 프로젝트 구조

```
your-project/
├── .claude/
│   ├── settings.local.json  # Hook 설정 (claude-duo init으로 생성)
│   └── claude.md            # 협업 컨텍스트 (claude-duo init으로 생성)
└── ... (your project files)
```

## .claude.md의 역할

`claude-duo init`으로 생성되는 `.claude/claude.md` 파일은 Claude Code가 시작될 때 자동으로 읽는 시스템 프롬프트입니다. 이 파일은:

- 다른 Claude 인스턴스와 협업 중임을 알립니다
- 간결하고 명확한 응답을 권장합니다
- 출력이 다른 인스턴스로 전달됨을 설명합니다
- 효과적인 협업 패턴을 제시합니다

## 사용 시나리오

### 시나리오 1: 풀스택 개발

```bash
cd ~/projects/my-app
claude-duo init
claude-duo start
```

- **Terminal A**: 백엔드 API 개발
- **Terminal B**: 프론트엔드 컴포넌트 개발
- A의 API 스펙이 자동으로 B에 전달되어 즉시 연동 작업 가능

### 시나리오 2: 코드 리뷰 & 개선

```bash
cd ~/projects/existing-project
claude-duo init
claude-duo start
```

- **Terminal A**: 기능 구현
- **Terminal B**: 코드 리뷰 및 개선 제안
- 상호 피드백을 통한 반복 개선

### 시나리오 3: 테스트 주도 개발

- **Terminal A**: 테스트 코드 작성
- **Terminal B**: 테스트를 통과하는 구현 작성

## 설정

### 포트 변경

```bash
PORT=8080 claude-duo start
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
            "command": "curl -X POST http://localhost:3000/hook -H 'Content-Type: application/json' -d '{\"type\":\"stop\",\"terminal_id\":\"'$TERMINAL_ID'\"}' &"
          }
        ]
      }
    ]
  }
}
```

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
git clone https://github.com/higgs-jung/claude-duo.git
cd claude-duo
npm install
npm start
```

### 프로젝트 구조

```
orchestration/
├── bin/
│   └── cli.js              # CLI 진입점 (init, start)
├── public/
│   ├── index.html          # 듀얼 터미널 UI
│   └── client.js           # WebSocket 클라이언트 + 자동 파이프라인
├── .claude/
│   └── settings.template.json   # Hook 설정 템플릿
├── claude.md               # 협업 컨텍스트 (init 시 복사됨)
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

`claude-duo start`를 실행한 디렉토리가 터미널의 작업 디렉토리가 됩니다. 올바른 프로젝트 폴더에서 실행했는지 확인하세요.

## 라이선스

MIT
