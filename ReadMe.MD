\# PalmDragon\_WebAR



\## 1. プロジェクト概要



PalmDragon\_WebAR は、スマートフォンのブラウザで動作する手のひら検知WebARです。



カメラ映像を全画面に表示し、その上にThree.jsの透明Canvasを重ねます。  

MediaPipe Hand Landmarkerで手の21点ランドマークを検出し、手のひら中心に龍の3Dモデルを表示します。



WebXR immersive-arには依存しないため、iPhone Safari / Android Chrome の両方で動作しやすい構成です。



主な機能:



\- getUserMediaでカメラ起動

\- 背面カメラ優先

\- MediaPipe Hand Landmarkerで手の検出

\- 手のひら中心の計算

\- Three.jsでGLB龍モデルを表示

\- 手の動きに龍が追従

\- 手を見失うと龍がフェードアウト

\- 手の大きさに応じて龍のサイズ変更

\- 手のひらを開くと龍が大きく明るく表示

\- 手のひらリング表示

\- 粒子エフェクト

\- ランドマーク表示ON/OFF

\- デバッグ表示ON/OFF



\---



\## 2. フォルダー構成



```txt

PalmDragon\_WebAR/

├─ index.html

├─ README.md

├─ css/

│  └─ style.css

├─ js/

│  ├─ app.js

│  └─ handDragonController.js

└─ assets/

&#x20;  └─ models/

&#x20;     └─ dragon.glb

