from fastapi import FastAPI, UploadFile, File
from pypdf import PdfReader
from docx import Document as DocumentFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import List
import json
import requests
import numpy as np

from app.database.db import Base, engine, SessionLocal
from app.database.models import (
    Conversation,
    Message,
    Document,
    DocumentChunk,
)
from app.llm.client import stream_llm


# =========================
# DATABASE
# =========================

Base.metadata.create_all(bind=engine)


# =========================
# APP
# =========================

app = FastAPI()


# =========================
# CORS
# =========================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# HELPERS
# =========================

def create_chat_title(question: str) -> str:
    title = " ".join(question.strip().split())

    if len(title) > 45:
        title = title[:45].rstrip() + "..."

    return title


def get_conversation(db, conversation_id: int):
    return (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id)
        .first()
    )


def get_conversation_context(db, conversation_id: int) -> str:
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(6)
        .all()
    )

    messages.reverse()

    return "\n".join(
        f"{message.role.capitalize()}: {message.content}"
        for message in messages
    )

def stream_and_save(
    prompt: str,
    conversation_id: int,
    source_filenames=None
):
    full_answer = ""

    try:
        # -------------------------
        # Stream AI response
        # -------------------------
        for chunk in stream_llm(prompt):

            yield chunk

            data = json.loads(chunk)

            full_answer += data.get(
                "response",
                ""
            )

        # -------------------------
        # Add verified sources
        # AFTER generation finishes
        # -------------------------
        if source_filenames:

         unique_sources = list(
           dict.fromkeys(source_filenames)
         )

         sources_text = (
          "\n\nSources:\n"
          + "\n".join(unique_sources)
         )

         source_chunk = json.dumps({
         "response": sources_text
         }) + "\n"

         yield source_chunk
            
    finally:

        if full_answer.strip():

            db = SessionLocal()

            db.add(
                Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=full_answer,
                )
            )

            db.commit()
            db.close()
# =========================
# HOME
# =========================

@app.get("/")
def home():
    return {
        "message": "Enterprise AI Copilot is running!"
    }


# =========================
# CREATE CONVERSATION
# =========================

@app.post("/conversations")
def create_conversation():
    db = SessionLocal()

    conversation = Conversation(
        title="New Chat"
    )

    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    result = {
        "id": conversation.id,
        "title": conversation.title,
    }

    db.close()

    return result


# =========================
# GET ALL CONVERSATIONS
# =========================

@app.get("/conversations")
def get_conversations():
    db = SessionLocal()

    conversations = (
        db.query(Conversation)
        .order_by(Conversation.created_at.desc())
        .all()
    )

    result = []

    for conversation in conversations:
        messages = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation.id
            )
            .order_by(Message.created_at)
            .all()
        )

        # Hide empty conversations from Recent.
        if not messages:
            continue

        # Fix old conversations that still have
        # the default title.
        if conversation.title == "New Chat":
            first_user_message = next(
                (
                    message
                    for message in messages
                    if message.role == "user"
                ),
                None,
            )

            if first_user_message:
                conversation.title = create_chat_title(
                    first_user_message.content
                )
                db.commit()

        result.append(
            {
                "id": conversation.id,
                "title": conversation.title,
            }
        )

    db.close()

    return result


# =========================
# GET ONE CONVERSATION
# =========================

@app.get("/conversations/{conversation_id}")
def get_one_conversation(conversation_id: int):
    db = SessionLocal()

    conversation = get_conversation(
        db,
        conversation_id
    )

    if not conversation:
        db.close()
        return {
            "error": "Conversation not found"
        }

    messages = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation_id
        )
        .order_by(Message.created_at)
        .all()
    )

    result = [
      {
        "id": message.id,
        "role": message.role,
        "content": message.content,

        "parent_message_id":
            message.parent_message_id,

        "version":
            message.version,

        "selected_text":
            message.selected_text,

        "selected_message_id":
            message.selected_message_id,
      }
     for message in messages
   ] 

    db.close()

    return result


# =========================
# DELETE CONVERSATION
# =========================

@app.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int):
    db = SessionLocal()

    conversation = get_conversation(
        db,
        conversation_id
    )

    if not conversation:
        db.close()
        return {
            "error": "Conversation not found"
        }

    db.delete(conversation)
    db.commit()
    db.close()

    return {
        "message": "Conversation deleted successfully"
    }


# =========================
# DOCUMENT UPLOAD
# =========================
import time

def get_embedding(text):

    start = time.time()

    response = requests.post(
        "http://localhost:11434/api/embed",
        json={
            "model": "nomic-embed-text",
            "input": text
        }
    )

    response.raise_for_status()

    embedding = response.json()["embeddings"][0]

    print(
        f"Embedding generated in {time.time() - start:.2f} seconds"
    )

    return embedding

def get_embeddings(texts):

    response = requests.post(
        "http://localhost:11434/api/embed",
        json={
            "model": "nomic-embed-text",
            "input": texts
        }
    )

    response.raise_for_status()

    return response.json()["embeddings"]


def search_chunks(query, top_k=5):

    query_embedding = np.array(
        get_embedding(query)
    )

    db = SessionLocal()

    try:

        # -------------------------
        # Normalize query
        # -------------------------

        import re

        stop_words = {
            "what", "is", "are", "the", "a", "an",
            "for", "of", "and", "or", "to", "in",
            "on", "with", "about", "does", "do",
            "how", "which", "mentioned", "tools",
            "languages", "scripting", "role", "roles"
        }

        query_words = {
            re.sub(r"[^a-z0-9]", "", word.lower())
            for word in query.split()
        }

        query_words = {
            word
            for word in query_words
            if word
            and word not in stop_words
            and len(word) >= 2
        }

        # -------------------------
        # Load documents
        # -------------------------

        documents = db.query(Document).all()

        # -------------------------
        # Find documents explicitly
        # mentioned by the query
        # -------------------------

        matched_documents = []

        for document in documents:

            filename = document.filename.lower()

            filename_words = {
                word
                for word in re.findall(
                    r"[a-z0-9]+",
                    filename
                )
            }

            matches = query_words.intersection(
                filename_words
            )

            # Strong document-name match
            if len(matches) >= 1:

                matched_documents.append(
                    (
                        len(matches),
                        document
                    )
                )

        # Sort strongest filename matches first

        matched_documents.sort(
            key=lambda item: item[0],
            reverse=True
        )

        # -------------------------
        # Decide candidate documents
        # -------------------------

        if matched_documents:

            # If query explicitly identifies a document,
            # search ONLY those documents.

            candidate_document_ids = {
                document.id
                for _, document in matched_documents
            }

            print(
                "\n========== DOCUMENT-TARGETED SEARCH =========="
            )

            for match_count, document in matched_documents:

                print(
                    f"Matched: {document.filename} "
                    f"| filename matches: {match_count}"
                )

            chunks = (
                db.query(
                    DocumentChunk,
                    Document
                )
                .join(
                    Document,
                    Document.id ==
                    DocumentChunk.document_id
                )
                .filter(
                    DocumentChunk.embedding.isnot(None),
                    Document.id.in_(
                        candidate_document_ids
                    )
                )
                .all()
            )

        else:

            # -------------------------
            # Normal semantic search
            # -------------------------

            print(
                "\n========== SEMANTIC SEARCH =========="
            )

            chunks = (
                db.query(
                    DocumentChunk,
                    Document
                )
                .join(
                    Document,
                    Document.id ==
                    DocumentChunk.document_id
                )
                .filter(
                    DocumentChunk.embedding.isnot(None)
                )
                .all()
            )

        # -------------------------
        # Rank chunks
        # -------------------------

        results = []

        for chunk, document in chunks:

            embedding = np.array(
                json.loads(chunk.embedding)
            )

            # Semantic similarity

            semantic_score = np.dot(
                query_embedding,
                embedding
            ) / (
                np.linalg.norm(query_embedding)
                * np.linalg.norm(embedding)
            )

            # Keyword matching

            chunk_text = chunk.content.lower()

            matched_words = sum(
                1
                for word in query_words
                if word in chunk_text
            )

            keyword_score = (
                matched_words / len(query_words)
                if query_words
                else 0
            )

            # Filename matching

            filename = document.filename.lower()

            filename_words = set(
                re.findall(
                    r"[a-z0-9]+",
                    filename
                )
            )

            filename_matches = len(
                query_words.intersection(
                    filename_words
                )
            )

            filename_score = (
                filename_matches /
                len(query_words)
                if query_words
                else 0
            )

            # -------------------------
            # Hybrid score
            # -------------------------

            hybrid_score = (
                0.65 * semantic_score
                + 0.25 * keyword_score
                + 0.10 * filename_score
            )

            # Strong boost for explicit
            # document-name match

            if filename_matches >= 2:
                hybrid_score += 0.50

            elif filename_matches == 1:
                hybrid_score += 0.25

            results.append(
                (
                    hybrid_score,
                    chunk,
                    document.filename,
                    semantic_score,
                    keyword_score,
                    filename_score
                )
            )

        # -------------------------
        # Keep multiple best chunks
        # from each document
        # -------------------------

        MAX_CHUNKS_PER_DOCUMENT = 3

        results.sort(
         key=lambda item: item[0],
         reverse=True
        )

        selected_results = []
        chunks_per_document = {}

        for result in results:

         score = result[0]
         chunk = result[1]

         document_id = chunk.document_id

         current_count = chunks_per_document.get(
         document_id,
         0)

         if current_count >= MAX_CHUNKS_PER_DOCUMENT:
            continue

         selected_results.append(result)

         chunks_per_document[document_id] = (
          current_count + 1
         )

        results = selected_results

        results.sort(
            key=lambda item: item[0],
            reverse=True
        )

        # -------------------------
        # Debug output
        # -------------------------

        print(
            "\n========== FINAL SEARCH RESULTS =========="
        )

        for result in results[:top_k]:

            print(
                f"Score: {result[0]:.4f} | "
                f"Semantic: {result[3]:.4f} | "
                f"Keyword: {result[4]:.4f} | "
                f"Filename: {result[5]:.4f} | "
                f"Document: {result[2]}"
            )

        return results[:top_k]

    finally:

        db.close()
        
def chunk_text(text, chunk_size=1000, overlap=200):
    chunks = []

    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        start += chunk_size - overlap

    return chunks

import time
    
@app.post("/documents/upload")
async def upload_documents(
    files: list[UploadFile] = File(...)
):
    if len(files) > 10:
        return {
            "error": "You can upload a maximum of 10 documents at once."
        }

    db = SessionLocal()

    documents = []
    skipped_files = []
    total_size = 0

    try:
        start_total = time.time()
        for file in files:
            existing_document = (
                db.query(Document)
                .filter(Document.filename == file.filename)
                .first()
            ) 
            if existing_document:
                skipped_files.append(file.filename)
                continue      
            filename = file.filename.lower()

            if not filename.endswith((".pdf", ".docx", ".txt")):
                return {
                    "error": (
                        f"{file.filename}: "
                        "Only PDF, DOCX and TXT files are supported."
                    )
                }

            content = await file.read()
            total_size += len(content)

            if total_size > 50 * 1024 * 1024:
                return {
                    "error": "Total upload size cannot exceed 50 MB."
                }
            start_extraction = time.time()
            if filename.endswith(".pdf"):
                from io import BytesIO

                reader = PdfReader(BytesIO(content))
                text = ""

                for page in reader.pages:
                    text += page.extract_text() or ""

            elif filename.endswith(".docx"):
                from io import BytesIO
            
            
                document_file = DocumentFile(BytesIO(content))

                text = "\n".join(
                    paragraph.text
                    for paragraph in document_file.paragraphs
                )

            else:
                text = content.decode("utf-8")
            
            print(
               f"Text extraction: "
               f"{time.time() - start_extraction:.2f}s"
            )
            if not text.strip():
                return {
                    "error": (
                        f"{file.filename}: "
                        "Could not extract text."
                    )
                }

            document = Document(
                filename=file.filename,
                content=text
            )

            db.add(document)
            db.flush()
            
            start_chunking = time.time()
            chunks = chunk_text(text)
            
            print(
                f"Chunking: "
                f"{time.time() - start_chunking:.2f}s"
            )
            
            start_embeddings = time.time()
            embeddings = get_embeddings(chunks)
            for index, (chunk, embedding) in enumerate(
                zip(chunks, embeddings)
            ):
                db.add(
                    DocumentChunk(
                        document_id=document.id,
                        content=chunk,
                        chunk_index=index,
                        embedding=json.dumps(embedding)
                    )
                )

            print(
                f"Embeddings total: "
                f"{time.time() - start_embeddings:.2f}s"
            )

            documents.append({
                "filename": file.filename,
                "chunks": len(chunks)
            })
        start_db = time.time()
        db.commit()
        print(
            f"Database commit: "
            f"{time.time() - start_db:.2f}s"
        )
        
        print(
            f"TOTAL UPLOAD: "
            f"{time.time() - start_total:.2f}s"
        )
        
        return {
            "message": "Documents uploaded successfully.",
            "documents": documents,
            "skipped": skipped_files
        }

    except Exception as error:
        db.rollback()

        return {
            "error": str(error)
        }

    finally:
        db.close()
        
@app.get("/search")
def search_documents(query: str):
    results = search_chunks(query)

    return [
        {
            "score": float(score),
            "content": chunk.content,
            "document_id": chunk.document_id,
            "chunk_index": chunk.chunk_index
        }
        for score, chunk in results
    ]
            
# =========================
# NORMAL QUESTION
# =========================

def is_follow_up_question(question: str) -> bool:
    """
    Detect whether a question likely depends on
    previous conversational context.

    This is intentionally conservative.
    """

    question_lower = question.lower().strip()

    follow_up_phrases = [
        "what about it",
        "what about this",
        "what about that",
        "tell me more",
        "explain more",
        "more about this",
        "more about that",
        "why is it",
        "why is this",
        "why is that",
        "how does it",
        "how does this",
        "how does that",
        "how is it",
        "how is this",
        "how is that",
        "what does it",
        "what does this",
        "what does that",
        "what services does it",
        "what are its",
        "what is its",
        "which one",
        "which is better",
        "compare them",
        "compare the two",
        "difference between them",
        "difference between these",
    ]

    return any(
        phrase in question_lower
        for phrase in follow_up_phrases
    )



def build_rag_prompt(question, context=""):
    db = SessionLocal()

    try:
        search_results = search_chunks(
            question,
            top_k=3
        )

        print("\n========== RAG SEARCH RESULTS ==========")

        for (
            score,
            chunk,
            filename,
            semantic_score,
            keyword_score,
            filename_score
        ) in search_results:
            print(
                f"Score: {score:.4f} | "
                f"Semantic: {semantic_score:.4f} | "
                f"Keyword: {keyword_score:.4f} | "
                f"Filename: {filename_score:.4f} | "
                f"Document: {filename}"
            )

        document_context_parts = []
        source_filenames = []

        for (
            score,
            chunk,
            filename,
            semantic_score,
            keyword_score,
            filename_score
        ) in search_results:

            document = (
                db.query(Document)
                .filter(
                    Document.id == chunk.document_id
                )
                .first()
            )

            if document:
                document_context_parts.append(
                    f"Source: {document.filename}\n"
                    f"{chunk.content}"
                )

                source_filenames.append(
                    document.filename
                )

        document_context = "\n\n".join(
            document_context_parts
        )

        prompt = f"""
Previous conversation:
{context}

Relevant enterprise documents:
{
    document_context
    if document_context
    else
    "No relevant enterprise document was found."
}

Current question:
{question}

Instructions:
- Answer using ONLY the information explicitly contained in the relevant enterprise documents above.
- Do NOT use general knowledge, assumptions, or outside information.
- Do NOT guess, infer, or add information that is not explicitly present in the documents.
- If the documents do not contain enough information to answer the question, say exactly:
  "The uploaded documents do not contain enough information to answer this question."

IMPORTANT EXTRACTION RULES:
- If the question asks what is "mentioned", "listed", "required", "included", or "specified", extract ALL distinct relevant items explicitly present in the provided document context.
- Do NOT omit relevant items just to make the answer shorter.
- Do NOT replace an explicit list with a partial summary.
- If the same item appears multiple times, mention it only once.
- Preserve the terminology used in the documents.
- Do not add examples that are not present in the documents.
- Do not describe how an item is commonly used unless that usage is explicitly stated in the documents.
- Every factual statement must be directly supported by the provided document context.
- Use the document context, not the previous conversation, as the authority for factual answers.
- Do not mention or use documents that are not provided in the context.
- Do not generate a Sources section.
"""

        return prompt, source_filenames

    finally:
        db.close()


# =========================
#  ENDPOINTS
# =========================        
import time

@app.get("/ask")
def ask(
    question: str,
    conversation_id: int,
):
    total_start = time.perf_counter()

    db = SessionLocal()

    # -------------------------
    # Get conversation
    # -------------------------
    start = time.perf_counter()

    conversation = get_conversation(
        db,
        conversation_id
    )

    print(
        f"Get conversation: "
        f"{time.perf_counter() - start:.3f}s"
    )

    if not conversation:
        db.close()

        return {
            "error": "Conversation not found"
        }

    # -------------------------
    # First question becomes title
    # -------------------------
    if conversation.title == "New Chat":

        start = time.perf_counter()

        conversation.title = create_chat_title(question)

        print(
            f"Create title: "
            f"{time.perf_counter() - start:.3f}s"
        )

    # -------------------------
    # Save user message
    # -------------------------
    start = time.perf_counter()

    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=question,
    )

    db.add(user_message)
    db.commit()

    print(
        f"Save user message: "
        f"{time.perf_counter() - start:.3f}s"
    )

    # -------------------------
    # Conversation context
    # -------------------------
    start = time.perf_counter()

    context = get_conversation_context(
        db,
        conversation_id
    )

    print(
        f"Conversation context: "
        f"{time.perf_counter() - start:.3f}s"
    )

    # -------------------------
    # Retrieve relevant documents
    # -------------------------
    start = time.perf_counter()

    search_results = search_chunks(
        question,
        top_k=3
    )

    print(
        f"Document search: "
        f"{time.perf_counter() - start:.3f}s"
    )

    print("\n========== NORMAL SEARCH RESULTS ==========")

    for (
    score,
    chunk,
    filename, 
    semantic_score,
    keyword_score,
    filename_score
    ) in search_results:
        print(
         f"Score: {score:.4f} | "
         f"Semantic: {semantic_score:.4f} | "
         f"Keyword: {keyword_score:.4f} | "
         f"Filename: {filename_score:.4f} | "
         f"Document: {filename}"
       )

    relevant_results = search_results

    # -------------------------
    # Prompt
    # -------------------------
    start = time.perf_counter()

    prompt, source_filenames = build_rag_prompt(
    question,
    context
    )

    print(
    f"Build RAG prompt: "
    f"{time.perf_counter() - start:.3f}s"
    )
    print(
        f"Build prompt: "
        f"{time.perf_counter() - start:.3f}s"
    )

    print(
        f"TOTAL BEFORE LLM: "
        f"{time.perf_counter() - total_start:.3f}s"
    )

    return StreamingResponse(
        stream_and_save(
            prompt,
            conversation_id,
            source_filenames
        ),
        media_type="application/x-ndjson",
    )
    
    
    
@app.get("/regenerate")
def regenerate(
    message_id: int,
    conversation_id: int,
):
    db = SessionLocal()

    try:
        original_message = (
            db.query(Message)
            .filter(
                Message.id == message_id,
                Message.conversation_id == conversation_id,
                Message.role == "assistant"
            )
            .first()
        )

        if not original_message:
            return {"error": "Assistant message not found"}

        user_message = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.id < original_message.id,
                Message.role == "user"
            )
            .order_by(Message.id.desc())
            .first()
        )

        if not user_message:
            return {"error": "User question not found"}

        context = ""

        prompt, source_filenames = build_rag_prompt(
            user_message.content,
            context
        )

        full_answer = ""

        for chunk in stream_llm(prompt):
            data = json.loads(chunk)
            full_answer += data.get("response", "")
        
        root_message_id = (
            original_message.parent_message_id
             or original_message.id
        )
        
        existing_versions = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.parent_message_id == root_message_id
            )
            .count()
        )

        new_message = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=full_answer,
            parent_message_id=root_message_id,
            version=existing_versions + 2
        )

        db.add(new_message)
        db.commit()
        db.refresh(new_message)

        return {
            "id": new_message.id,
            "content": new_message.content,
            "version": new_message.version,
            "sources": list(dict.fromkeys(source_filenames))
        }

    finally:
        db.close()
    
    
    
# =========================
# QUESTION ABOUT SELECTED TEXT
# =========================

@app.get("/ask-selection")
def ask_selection(
    question: str,
    selected_text: str,
    selected_message_id: int,
    conversation_id: int,
):
    db = SessionLocal()

    conversation = get_conversation(
        db,
        conversation_id
    )

    if not conversation:
        db.close()
        return {
            "error": "Conversation not found"
        }

    # -------------------------
    # Save user message
    # -------------------------

    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=question,
        selected_text=selected_text,
        selected_message_id=selected_message_id,
    )

    db.add(user_message)
    db.commit()

    # -------------------------
    # Previous conversation
    # -------------------------

    context = ""

    # -------------------------
    # Retrieve relevant documents
    # -------------------------

    search_query = (
        f"{selected_text}\n\n"
        f"{question}"
    )

    search_results = search_chunks(
        search_query,
        top_k=3
    )

    print("\n========== SELECTION SEARCH RESULTS ==========")

    for (
    score,
    chunk,
    filename,
    semantic_score,
    keyword_score,
    filename_score
    ) in search_results:
        
        print(
            f"Score: {score:.4f} | "
            f"Document ID: {chunk.document_id}"
        )

    # Stricter threshold for selected-text questions
    RELEVANCE_THRESHOLD = 0.75

    relevant_results = [
     (
        score,
        chunk,
        filename,
        semantic_score,
        keyword_score,
        filename_score
     )
     for (
        score,
        chunk,
        filename,
        semantic_score,
        keyword_score,
        filename_score
     ) in search_results
     if score >= RELEVANCE_THRESHOLD
     ]

    # -------------------------
    # Build document context
    # -------------------------

    document_context_parts = []
    source_filenames = []

    for score, chunk in relevant_results:

        document = (
            db.query(Document)
            .filter(
                Document.id == chunk.document_id
            )
            .first()
        )

        if document:

            document_context_parts.append(
                f"Source: {document.filename}\n"
                f"{chunk.content}"
            )

            source_filenames.append(
                document.filename
            )

    document_context = "\n\n".join(
        document_context_parts
    )

    db.close()

    # -------------------------
    # Prompt
    # -------------------------

    prompt = f"""
Text selected by the user:
{selected_text}

Relevant enterprise documents:
{
    document_context
    if document_context
    else
    "No relevant enterprise document was found."
}

User's question about the selected text:
{question}

Instructions:
- Answer specifically in relation to the selected text.
- Treat the selected text as the primary source.
- Use the selected text as the authority for factual claims about the selected content.
- Do not ignore or replace information from the selected text.
- Do not use unrelated previous conversation.
- Use enterprise documents only when they directly support or clarify the selected text or the user's question.
- Do NOT use general knowledge to add information that is not supported by the selected text or relevant enterprise documents.
- Do NOT guess or infer unsupported information.
- If the selected text and relevant enterprise documents do not contain enough information to answer the question, say:
  "The provided text and documents do not contain enough information to answer this question."

IMPORTANT EXTRACTION RULES:
- If the question asks what is "mentioned", "listed", "required", "included", or "specified", extract ALL distinct relevant items explicitly present in the selected text and directly relevant document context.
- Do not omit relevant items merely to shorten the answer.
- Do not add examples that are not present in the provided text or documents.
- Do not describe common/general usage unless it is explicitly supported by the provided material.
- Do not invent document sources.
- Do not generate a Sources section.
"""

    return StreamingResponse(
        stream_and_save(
            prompt,
            conversation_id,
            source_filenames
        ),
        media_type="application/x-ndjson",
    )