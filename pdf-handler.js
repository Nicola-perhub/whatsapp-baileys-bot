const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

class PDFHandler {
    constructor() {
        this.tempDir = path.join(__dirname, 'temp');
        this.ensureTempDir();
    }

    // Crea directory temporanea se non exists
    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    // Estrae testo da buffer PDF
    async extractTextFromBuffer(buffer, fileName = 'document.pdf') {
        try {
            console.log(`📄 Inizio parsing PDF: ${fileName}`);
            
            const data = await pdfParse(buffer, {
                // Opzioni parsing
                max: 0, // 0 = no limit
                version: 'v2.0.550'
            });

            const result = {
                fileName: fileName,
                pageCount: data.numpages,
                textContent: data.text,
                wordCount: this.countWords(data.text),
                metadata: {
                    info: data.info || {},
                    extractedAt: new Date().toISOString(),
                    fileSize: buffer.length
                },
                summary: this.generateQuickSummary(data.text)
            };

            console.log(`✅ PDF parsed: ${result.pageCount} pagine, ${result.wordCount} parole`);
            return result;

        } catch (error) {
            console.error(`❌ Errore parsing PDF ${fileName}:`, error);
            throw new Error(`Errore lettura PDF: ${error.message}`);
        }
    }

    // Salva PDF temporaneamente (se necessario)
    async saveTempPDF(buffer, fileName) {
        try {
            const filePath = path.join(this.tempDir, `${Date.now()}_${fileName}`);
            fs.writeFileSync(filePath, buffer);
            
            // Auto-cleanup dopo 1 ora
            setTimeout(() => {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️  File temp rimosso: ${fileName}`);
                }
            }, 3600000); // 1 ora
            
            return filePath;
        } catch (error) {
            console.error('❌ Errore salvataggio temp:', error);
            throw error;
        }
    }

    // Conta parole nel testo
    countWords(text) {
        if (!text) return 0;
        return text.trim().split(/\s+/).length;
    }

    // Genera sommario veloce del contenuto
    generateQuickSummary(text) {
        if (!text || text.length < 100) {
            return "Documento troppo corto per generare sommario";
        }

        // Primi 500 caratteri come anteprima
        const preview = text.substring(0, 500).trim();
        
        // Cerca patterns comuni
        const patterns = {
            hasNumbers: /\d+/.test(text),
            hasEmails: /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text),
            hasUrls: /https?:\/\//.test(text),
            hasDates: /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(text),
            hasPrice: /€|\$|EUR|USD|\d+[,\.]\d{2}/.test(text)
        };

        return {
            preview: preview + (text.length > 500 ? "..." : ""),
            characteristics: patterns,
            estimatedReadTime: Math.ceil(this.countWords(text) / 200) // 200 parole/minuto
        };
    }

    // Estrae sezioni principali (titoli, paragrafi)
    extractSections(text) {
        if (!text) return [];

        const lines = text.split('\n').filter(line => line.trim().length > 0);
        const sections = [];
        let currentSection = null;

        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Possibili titoli (maiuscole, brevi, numeri)
            if (this.isLikelyTitle(trimmed)) {
                if (currentSection) {
                    sections.push(currentSection);
                }
                currentSection = {
                    title: trimmed,
                    content: [],
                    startLine: index
                };
            } else if (currentSection && trimmed.length > 20) {
                currentSection.content.push(trimmed);
            }
        });

        // Aggiungi ultima sezione
        if (currentSection) {
            sections.push(currentSection);
        }

        return sections;
    }

    // Determina se una riga è probabilmente un titolo
    isLikelyTitle(text) {
        if (!text || text.length > 100) return false;
        
        // Criteri per titoli
        const criteria = [
            text.length < 80,                          // Non troppo lungo
            text.toUpperCase() === text,               // Tutto maiuscolo
            /^\d+\.?\s/.test(text),                   // Inizia con numero
            /^[A-Z][A-Z\s\d\.\-:]+$/.test(text),     // Solo maiuscole e punteggiatura
            !/[a-z]{10,}/.test(text)                  // Non molte minuscole consecutive
        ];

        // Almeno 2 criteri devono essere veri
        return criteria.filter(Boolean).length >= 2;
    }

    // Pulisce directory temporanea
    cleanupTempDir() {
        try {
            const files = fs.readdirSync(this.tempDir);
            files.forEach(file => {
                const filePath = path.join(this.tempDir, file);
                const stats = fs.statSync(filePath);
                
                // Rimuovi file più vecchi di 2 ore
                if (Date.now() - stats.mtime.getTime() > 7200000) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️  File temp scaduto rimosso: ${file}`);
                }
            });
        } catch (error) {
            console.error('❌ Errore cleanup temp dir:', error);
        }
    }

    // Valida se il buffer è un PDF valido
    isValidPDF(buffer) {
        try {
            // Un PDF deve iniziare con %PDF-
            const header = buffer.toString('ascii', 0, 8);
            return header.startsWith('%PDF-');
        } catch (error) {
            return false;
        }
    }
}

// Cleanup automatico ogni ora
const pdfHandler = new PDFHandler();
setInterval(() => {
    pdfHandler.cleanupTempDir();
}, 3600000); // 1 ora

module.exports = PDFHandler;
