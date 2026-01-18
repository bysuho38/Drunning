# 명령 프롬프트 실행 가이드

## 현재 디렉토리로 이동하는 방법

### 방법 1: 탐색기에서 열기
1. `C:\Users\1\Desktop\DrawingRun` 폴더를 탐색기에서 열기
2. 주소창에 `cmd` 입력 후 Enter
3. 명령 프롬프트가 해당 폴더에서 열림

### 방법 2: 명령 프롬프트에서 직접 이동
```bash
cd C:\Users\1\Desktop\DrawingRun
```

### 방법 3: PowerShell에서 이동
```powershell
cd C:\Users\1\Desktop\DrawingRun
```

---

## 파일 실행 방법

### 1. 웹 서버 실행
```bash
start_server.bat
```
또는
```bash
py -m http.server 8000 --bind 127.0.0.1
```

### 2. 모든 도로 데이터 수집 (5-10분 소요)
```bash
fetch_all_roads.bat
```
또는
```bash
py fetch_all_roads.py
```

### 3. 주요 도로만 수집 (1-2분 소요)
```bash
py fetch_roads.py
```

---

## 빠른 참조

### 현재 디렉토리 확인
```bash
cd
```

### 파일 목록 보기
```bash
dir
```

### Python 버전 확인
```bash
py --version
```

### 서버 중지
서버가 실행 중인 명령 프롬프트 창에서 `Ctrl+C` 누르기

---

## 문제 해결

### "py는 내부 또는 외부 명령..." 오류
- Python이 설치되어 있는지 확인: `py --version`
- Python이 설치되어 있지 않다면 [python.org](https://www.python.org/downloads/)에서 설치

### "포트가 이미 사용 중" 오류
- 다른 포트 사용: `py -m http.server 8080 --bind 127.0.0.1`
- 또는 사용 중인 프로세스 종료

### 방화벽 경고
- Windows 방화벽 경고가 뜨면 "액세스 허용" 클릭



