// Vision prompt: read a generated video take as a contact sheet, list artifacts and name the
// longest clean run of cells.
export const inspectClipPrompt = ({ cells, t0, step, prompt, brief }) => `Contact sheet of one AI-generated video take, read row by row, left to right, cell 0 first. ${cells} cells; cell i shows t = ${t0}s + i×${step}s.
The take was asked for: ${prompt}${brief ? `\nWhat the shot must do: ${brief}` : ""}
Find generation artifacts: a person or object duplicated or appearing from nowhere, faces, hands or bodies deforming, things melting or popping, garbled text or logos, sudden jumps of the camera. Then name the longest run of consecutive clean, steady cells.
Reply only JSON: {"score": <1-10 usable quality>, "issues": [{"cell": <i>, "issue": "<Chinese, under 30 chars>"}], "best": {"from": <first clean cell>, "to": <last clean cell>}}`;
