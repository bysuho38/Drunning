@echo off
echo ========================================
echo   드러닝 웹 서버 시작
echo ========================================
echo.
echo 서버가 시작되었습니다!
echo.
echo 데스크톱 접속: http://localhost:8000
echo.
echo 모바일 접속을 위해:
echo 1. 같은 Wi-Fi 네트워크에 연결되어 있는지 확인하세요
echo 2. 아래 명령어로 컴퓨터 IP 주소를 확인하세요:
echo    ipconfig ^| findstr IPv4
echo 3. 모바일 브라우저에서 http://[컴퓨터IP]:8000 접속
echo.
echo 예시: http://192.168.0.100:8000
echo.
echo Windows 방화벽 경고가 뜨면 "액세스 허용"을 클릭하세요
echo.
echo 서버 중지: Ctrl+C
echo ========================================
echo.
py -m http.server 8000 --bind 0.0.0.0
pause

