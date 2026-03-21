SparxLess Installation

V1.3.0 Alpha v5

[<img src="https://img.youtube.com/vi/2TPXqmkxeZs/hqdefault.jpg" width="600" height="400"
/>](https://www.youtube.com/embed/2TPXqmkxeZs)

1. How to Download the Extension
To ensure the extension works correctly, always download the latest Stable Release rather than the development code.

Go to the SparxLess GitHub Repository.

On the right-hand side, click on Releases.

<img width="960" height="564" alt="image" src="https://github.com/user-attachments/assets/3f084fa1-ab64-4af3-bc84-608325be7fe2" />

Look for the version tagged Latest.

<img width="276" height="147" alt="image" src="https://github.com/user-attachments/assets/aec68e0c-900f-4408-9abb-7dcf3df23b0e" />

Under the Assets section, click on SparxLess.zip to download it.

<img width="960" height="564" alt="image" src="https://github.com/user-attachments/assets/2c337794-f14b-462b-a5af-2e2cbd1036d4" />

Extract the ZIP file to a folder on your computer (e.g., your Desktop).

2. Project Structure
After extracting, ensure your folder contains these files. Note: GitHub usually adds the version number to the folder name (e.g., SparxLess-v1.0.0).

```
SparxLess/
├── .gitattributes
├── Icon/
│   ├── SettingIcon.png
│   ├── Sparx_Math_Logo_128.png
│   ├── Sparx_Math_Logo_16.png
│   ├── Sparx_Math_Logo_32.png
│   └── Sparx_Math_Logo_48.png
├── README.md
├── background.js
├── content.js
├── manifest.json
├── popup.css
├── popup.html
└── popup.js
```

3. How to Install the Extension

Open your browser and click on the three dots in the top right corner.

<img width="960" height="564" alt="image" src="https://github.com/user-attachments/assets/fad67fec-fbb2-44ea-a501-b3110a18c864" />

Click on Extensions.

<img width="281" height="519" alt="image" src="https://github.com/user-attachments/assets/390429bd-902f-4013-9a3b-c89ba419d25f" />

Click on Manage Extensions.

<img width="340" height="186" alt="image" src="https://github.com/user-attachments/assets/cda276ca-e76b-4daf-b3fe-7ac9c8c298db" />

In the top-right corner, switch on Developer mode.
<img width="960" height="564" alt="image" src="https://github.com/user-attachments/assets/b9867df9-0292-4704-9066-e254453b7e50" />

Click the Load unpacked button that appears.

<img width="960" height="564" alt="image" src="https://github.com/user-attachments/assets/18bb4bf1-96d7-4cde-ae01-931c47653713" />

Select the extracted folder (the one containing the manifest.json file).

Click the Puzzle Piece icon in your browser toolbar and "Pin" SparxLess AI for easy access.

4. Setting Up
Click the SparxLess icon in your toolbar.

Click the Settings Icon (top right of the popup).
(Insert your "Settings Icon" screenshot here)

Enter your Gemini API Key.

Note: You can get a free key at aistudio.google.com.

Select Gemma 3 27B for the best balance of quota and speed.

Click APPLY CHANGES.

5. Usage
Open a Sparx Maths task.

The extension will automatically detect the problem text.

Click SOLVE PROBLEM.

The AI will calculate the answer, display the reasoning, and attempt to fill the input box automatically.

Future plans:
 - Adding support for more and different AI APIs
 - Adding a global answer database (so you get the answer without using ai, just from people who had that question before)

All credits goes to:
Ant - For compiling and testing the extension
Gemini - For helping to make the UI
Claude  - For implementing the text/image extractor

FYI, this project is vibe coded so there maybe bugs and optimisation issues with the code.

As of the Sixteeth of Febuary 2026, this extension work on https://maths.sparx-learning.com which is it's intented Usage.
However, this may subject to change with the changes in sparxs' web structure and possible future anti-scrapping methods.
I may not make any more updates to this extension, so this probably will not keep up with any security measures set in
place in the future.
