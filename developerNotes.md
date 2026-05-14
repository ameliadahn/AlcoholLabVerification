Development Notes and Design Decisions — Full Documentation

Framework and Approach

I chose Next.js because it handles both the frontend and backend API routes in a single project. The server-side routes were important for keeping the Anthropic API key off the client. I used Tailwind for styling to avoid writing a lot of custom CSS and to keep the UI clean and accessible, which the interview notes made clear was a hard requirement.

AI Model Selection

I originally used GPT-4o because of its strong image analysis capabilities. I later switched to Claude Haiku due to lower cost and faster processing while still maintaining strong accuracy. I also considered Gemini Flash, but accuracy was prioritized over speed.

OCR for Government Warning

Language models tend to auto-complete the mandatory Government Warning text even when it is blurry or missing entirely. To avoid false passes on this field, I decided to rely on Tesseract OCR for Government Warning verification rather than AI extraction. The AI returns null for that field by design, and the client runs Tesseract in parallel, then patches the result before displaying it.

Multi-Panel Support

I originally scoped the system to accept a single image per label submission. After additional research, I updated the workflow to support multiple label images because important information often appears on the back, neck, or side panels. Analyzing all panels as a set produces significantly better results than analyzing each image in isolation.

Application Data Input

Manual application data entry would be too tedious, especially in a batch workflow. For single submissions, a user can upload a document image and the model extracts the fields automatically. For batch verification, I disabled AI document extraction to reduce cost and processing time and implemented CSV/file import instead.

Batch Processing

I added a batch mode that processes up to 15 submissions with a concurrency limit of 7 and a short stagger between slot starts. The queue handles rate-limit responses automatically with a 20-second wait and up to three retries. The 15-submission cap is conservative for a prototype — the architecture would scale by increasing the concurrency limit or paginating larger batches.

Prohibited Claims

I read that prohibited claims may cause a label to fail and decided to add this to automate the workflow more. Clearly prohibited claims are auto-failed, while claims that may require supporting documentation are flagged for review. In the future, I would like the system to compare claims against submitted paperwork for a more automated workflow.

Validation Summaries

I added summaries explaining which fields failed or were flagged and why, making manual review faster and easier. The goal was to surface the most actionable information at the top so a reviewer could decide quickly without reading through every field row.

Fine-Tuning

I considered fine-tuning a model on TTB label data, and the scripts directory has an offline pipeline for this. Due to time constraints, I focused instead on prompt engineering, OCR integration, and workflow design.

Performance

One challenge was balancing performance expectations, in the provided interviews some suggested 5–10 minutes per review was typical for a human reviewer, while others said reviewers would abandon any system taking longer than 5 seconds. I focused on making analysis as fast as possible using a faster model, resizing images before upload, and running OCR in parallel with the API call. I was not able to get individual processing down to 5 seconds consistently, but with batch uploads, the time averages about 2.3 seconds per label. I opted for accuracy over speed as one of my tradeoffs.

Infrastructure and Security

Since this is a prototype, I prioritized functionality first and planned to address deployment and integration concerns later. The API key is handled server-side and no label data is stored.

Assumptions

The system assumes label images are photographs or scans at a resolution Tesseract can read, and that application data is available as a structured file, a document photo, or manual entry. It does not assume integration with COLAs Online or any TTB backend. Label dimensions, font sizes, and color contrast are out of scope as that information was not reliably available in the application data.