# AskBoard – AI-Assisted Interactive Study Assistant

AskBoard is an AI-powered study assistant that enables users to interact with their PDF documents through contextual question answering, summaries, quizzes, and hints. It combines Retrieval-Augmented Generation (RAG) with gesture-based interaction to make document-based learning more interactive.

## Key Features

- **PDF Processing:** Extracts text page by page from uploaded PDF documents using PyPDF.
- **Semantic Search:** Converts overlapping text chunks into 384-dimensional embeddings using Sentence Transformers.
- **Vector Retrieval:** Stores and retrieves relevant document chunks using ChromaDB.
- **Context-Aware AI Responses:** Integrates the Gemini API with retrieved document context to generate relevant answers.
- **Page References:** Provides document page references alongside generated answers.
- **AI-Assisted Learning:** Supports summaries, quizzes, and contextual hints.
- **Gesture-Based Interaction:** Uses MediaPipe Hands for browser-based hand landmark tracking and gesture interaction.

## System Architecture

```text
              PDF Document
                    |
                    v
             PDF Text Extraction
                    |
                    v
              Text Chunking
                    |
                    v
          Sentence Transformers
             (Embeddings)
                    |
                    v
                ChromaDB
             (Vector Storage)
                    |
                    v
           Semantic Retrieval
                    |
                    v
              Gemini API
                    |
                    v
       Context-Aware AI Responses
                    |
                    v
          Frontend Presentation
```

## Technology Stack

| Component | Technologies |
|---|---|
| Backend | Python, FastAPI |
| AI / LLM | Gemini API |
| Embeddings | Sentence Transformers |
| Vector Database | ChromaDB |
| PDF Processing | PyPDF |
| Gesture Recognition | MediaPipe Hands |
| Frontend | JavaScript, HTML, CSS |

## RAG Pipeline

AskBoard uses a Retrieval-Augmented Generation pipeline:

1. **Document Ingestion:** Extracts page-wise text from uploaded PDF files.
2. **Text Chunking:** Splits extracted content into overlapping chunks while retaining page references.
3. **Embedding Generation:** Generates 384-dimensional semantic embeddings using `all-MiniLM-L6-v2`.
4. **Vector Storage:** Persists embeddings and associated document metadata in ChromaDB.
5. **Semantic Retrieval:** Retrieves relevant chunks based on the user's query.
6. **Response Generation:** Passes retrieved context to Gemini to generate document-grounded responses.

## Project Structure

```text
AskBoard/
│
├── backend/
│   ├── main.py
│   ├── rag.py
│   └── ...
│
├── frontend/
│   └── ...
│
├── .env.example
├── .gitignore
├── requirements.txt
└── README.md
```

*Note: The structure above is illustrative. Refer to the actual repository for the complete implementation.*

## Getting Started

### Prerequisites

- Python 3.10+
- pip
- Gemini API key
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/ForamAmin/AskBoard.git
cd AskBoard
```

### 2. Create a Virtual Environment

```bash
python -m venv .venv
```

Activate it:

**Windows:**
```bash
.venv\Scripts\activate
```

**macOS / Linux:**
```bash
source .venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Create a `.env` file in the project root using `.env.example` as a reference.

Add your Gemini API key and any other configuration required by the application.

```env
GEMINI_API_KEY=your_gemini_api_key
```

Never commit your actual API key or `.env` file.

### 5. Start the Backend

From the project root, run the command corresponding to your FastAPI entry point:

```bash
uvicorn backend.main:app --reload
```

If your backend uses a different module path, adjust the command accordingly.

Backend API documentation:

`http://127.0.0.1:8000/docs`

### 6. Start the Frontend

Run the frontend using your configured development server or open the frontend entry point using VS Code Live Server, depending on the project setup.

## Future Improvements

- Improve retrieval relevance through query optimisation and reranking.
- Add document-level conversation history.
- Introduce retrieval evaluation and response quality metrics.
- Expand gesture-based controls for hands-free learning.
- Improve handling of larger and multiple PDF documents.


*Built to make document-based learning more interactive through AI and intelligent information retrieval.*
