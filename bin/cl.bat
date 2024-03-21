@echo off

SET SelfPath=%~dp0

for /f "usebackq tokens=*" %%i in (`%SelfPath%vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
  set InstallDir=%%i
)

call "%InstallDir%\Common7\Tools\vsdevcmd.bat" -arch=x64

cl.exe %*
