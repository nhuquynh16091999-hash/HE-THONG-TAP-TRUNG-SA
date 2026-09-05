import chromadb
import os

# Configuration
DB_PATH = os.path.join(os.path.dirname(__file__), "chroma_db")
COLLECTION_NAME = "agent_knowledge"

class KnowledgeBase:
    def __init__(self):
        self.client = chromadb.PersistentClient(path=DB_PATH)
        self.collection = self.client.get_collection(name=COLLECTION_NAME)

    def search(self, query, top_k=3):
        results = self.collection.query(
            query_texts=[query],
            n_results=top_k
        )
        
        # Parse Chroma result format
        # results is a dict with lists of lists (batch format)
        parsed_results = []
        if results['documents']:
            for i in range(len(results['documents'][0])):
                parsed_results.append({
                    "text": results['documents'][0][i],
                    "source": results['metadatas'][0][i]['source'],
                    "distance": results['distances'][0][i] if 'distances' in results else 0
                })
                
        return parsed_results

if __name__ == "__main__":
    kb = KnowledgeBase()
    res = kb.search("hoàn hàng")
    for r in res:
        print(r)
