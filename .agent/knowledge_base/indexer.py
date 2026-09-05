import os
import glob
import chromadb
from chromadb.utils import embedding_functions

# Configuration
KNOWLEDGE_DIR = "config/manual_data"
RULES_FILE = "RULES.md"
DB_PATH = ".agent/knowledge_base/chroma_db"
COLLECTION_NAME = "agent_knowledge"

def load_documents():
    docs = []
    
    # Load RULES.md
    if os.path.exists(RULES_FILE):
        with open(RULES_FILE, 'r', encoding='utf-8') as f:
            content = f.read()
            docs.append({"source": RULES_FILE, "content": content})
    
    # Load manual data
    for filepath in glob.glob(os.path.join(KNOWLEDGE_DIR, "*.md")):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            docs.append({"source": filepath, "content": content})
            
    return docs

def chunk_text(text, source, chunk_size=1000):
    """Chunking by paragraphs."""
    chunks = []
    paragraphs = text.split('\n\n')
    current_chunk = ""
    
    for p in paragraphs:
        if len(current_chunk) + len(p) < chunk_size:
            current_chunk += p + "\n\n"
        else:
            if current_chunk.strip():
                chunks.append({"text": current_chunk.strip(), "source": source})
            current_chunk = p + "\n\n"
            
    if current_chunk.strip():
        chunks.append({"text": current_chunk.strip(), "source": source})
        
    return chunks

def main():
    print("--- Knowledge Base Indexer (ChromaDB Backend) ---")
    
    # 1. Load Documents
    raw_docs = load_documents()
    print(f"Loaded {len(raw_docs)} documents.")
    
    all_chunks = []
    for doc in raw_docs:
        chunks = chunk_text(doc['content'], doc['source'])
        all_chunks.extend(chunks)
        
    print(f"Created {len(all_chunks)} chunks.")
    if not all_chunks:
        print("No content to index.")
        return

    # 2. Store in ChromaDB
    # Chroma handles embeddings automatically via default EF (SentenceTransformers/ONNX)
    try:
        client = chromadb.PersistentClient(path=DB_PATH)
        # Delete if exists to refresh index
        try:
            client.delete_collection(COLLECTION_NAME)
        except:
            pass
            
        collection = client.get_or_create_collection(name=COLLECTION_NAME)
        
        ids = [f"id_{i}" for i in range(len(all_chunks))]
        documents = [c['text'] for c in all_chunks]
        metadatas = [{"source": c['source']} for c in all_chunks]
        
        print("Embedding and Indexing (this may take a moment)...")
        collection.add(
            documents=documents,
            metadatas=metadatas,
            ids=ids
        )
        
        print(f"Successfully indexed {len(all_chunks)} items into ChromaDB.")
        
    except Exception as e:
        print(f"ChromaDB Error: {e}")

if __name__ == "__main__":
    main()
