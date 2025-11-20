import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TaxRecord {
  id: number;
  name: string;
  income: string;
  deduction: string;
  taxAmount: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface TaxAnalysis {
  taxRate: number;
  effectiveRate: number;
  deductionImpact: number;
  complianceScore: number;
  riskLevel: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ name: "", income: "", deduction: "" });
  const [selectedRecord, setSelectedRecord] = useState<TaxRecord | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ income: number | null; deduction: number | null }>({ income: null, deduction: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("records");
  const [searchTerm, setSearchTerm] = useState("");
  const [faqOpenIndex, setFaqOpenIndex] = useState<number | null>(null);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) {
        return;
      }
      
      if (isInitialized) {
        return;
      }
      
      if (fhevmInitializing) {
        return;
      }
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM after wallet connection...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: TaxRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: parseInt(businessId.replace('tax-', '')) || Date.now(),
            name: businessData.name,
            income: businessId,
            deduction: businessId,
            taxAmount: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTaxRecords(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating tax record with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const incomeValue = parseInt(newRecordData.income) || 0;
      const businessId = `tax-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, incomeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newRecordData.deduction) || 0,
        0,
        "Tax Record"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Tax record created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRecordData({ name: "", income: "", deduction: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRecord(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const analyzeTax = (record: TaxRecord, decryptedIncome: number | null, decryptedDeduction: number | null): TaxAnalysis => {
    const income = record.isVerified ? (record.decryptedValue || 0) : (decryptedIncome || record.publicValue1 || 50000);
    const deduction = record.publicValue1 || 10000;
    
    const taxableIncome = Math.max(0, income - deduction);
    const taxRate = taxableIncome > 100000 ? 0.3 : taxableIncome > 50000 ? 0.2 : 0.1;
    const taxAmount = taxableIncome * taxRate;
    const effectiveRate = income > 0 ? taxAmount / income : 0;
    
    const deductionImpact = deduction / income;
    const complianceScore = Math.min(100, 85 + (deductionImpact * 15));
    const riskLevel = Math.max(10, Math.min(90, 100 - complianceScore));

    return {
      taxRate: taxRate * 100,
      effectiveRate: effectiveRate * 100,
      deductionImpact: deductionImpact * 100,
      complianceScore,
      riskLevel
    };
  };

  const renderDashboard = () => {
    const totalRecords = taxRecords.length;
    const verifiedRecords = taxRecords.filter(m => m.isVerified).length;
    const avgDeduction = taxRecords.length > 0 
      ? taxRecords.reduce((sum, m) => sum + m.publicValue1, 0) / taxRecords.length 
      : 0;
    
    const recentRecords = taxRecords.filter(m => 
      Date.now()/1000 - m.timestamp < 60 * 60 * 24 * 7
    ).length;

    return (
      <div className="dashboard-panels">
        <div className="panel metal-panel">
          <h3>Total Records</h3>
          <div className="stat-value">{totalRecords}</div>
          <div className="stat-trend">+{recentRecords} this week</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{verifiedRecords}/{totalRecords}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Avg Deduction</h3>
          <div className="stat-value">${avgDeduction.toFixed(0)}</div>
          <div className="stat-trend">Protected</div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = (record: TaxRecord, decryptedIncome: number | null, decryptedDeduction: number | null) => {
    const analysis = analyzeTax(record, decryptedIncome, decryptedDeduction);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Tax Rate</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.taxRate}%` }}
            >
              <span className="bar-value">{analysis.taxRate.toFixed(1)}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Effective Rate</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.effectiveRate}%` }}
            >
              <span className="bar-value">{analysis.effectiveRate.toFixed(1)}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Deduction Impact</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.deductionImpact}%` }}
            >
              <span className="bar-value">{analysis.deductionImpact.toFixed(1)}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Compliance Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.complianceScore}%` }}
            >
              <span className="bar-value">{analysis.complianceScore.toFixed(0)}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Risk Level</div>
          <div className="chart-bar">
            <div 
              className="bar-fill growth" 
              style={{ width: `${analysis.riskLevel}%` }}
            >
              <span className="bar-value">{analysis.riskLevel.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Income Encryption</h4>
            <p>Tax data encrypted with Zama FHE 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Secure Storage</h4>
            <p>Encrypted data stored on-chain securely</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Local Decryption</h4>
            <p>Client performs offline decryption</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>On-chain Verification</h4>
            <p>Submit proof for FHE verification</p>
          </div>
        </div>
      </div>
    );
  };

  const filteredRecords = taxRecords.filter(record =>
    record.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const faqItems = [
    {
      question: "What is FHE (Fully Homomorphic Encryption)?",
      answer: "FHE allows computations on encrypted data without decryption, ensuring complete privacy while maintaining functionality."
    },
    {
      question: "How does the tax calculator protect my data?",
      answer: "All sensitive financial data is encrypted using Zama FHE technology and never leaves your device unencrypted."
    },
    {
      question: "Is this tax calculator compliant with regulations?",
      answer: "Yes, the system is designed to meet all privacy and tax compliance requirements while using advanced encryption."
    },
    {
      question: "Can I export my tax records?",
      answer: "Encrypted records can be exported for backup, but decryption requires your private keys for security."
    }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Tax Calculator 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted tax calculation system and access your private tax records.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start managing your encrypted tax records</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted tax system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Tax Calculator 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Tax Record
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <nav className="app-navigation">
        <button 
          className={`nav-tab ${activeTab === "records" ? "active" : ""}`}
          onClick={() => setActiveTab("records")}
        >
          Tax Records
        </button>
        <button 
          className={`nav-tab ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          Statistics
        </button>
        <button 
          className={`nav-tab ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          FAQ
        </button>
      </nav>
      
      <div className="main-content-container">
        {activeTab === "records" && (
          <>
            <div className="dashboard-section">
              <h2>Private Tax Analytics (FHE 🔐)</h2>
              {renderDashboard()}
              
              <div className="panel metal-panel full-width">
                <h3>FHE 🔐 Privacy Protection</h3>
                {renderFHEFlow()}
              </div>
            </div>
            
            <div className="records-section">
              <div className="section-header">
                <h2>Tax Records</h2>
                <div className="header-actions">
                  <input
                    type="text"
                    placeholder="Search records..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                  <button 
                    onClick={loadData} 
                    className="refresh-btn" 
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="records-list">
                {filteredRecords.length === 0 ? (
                  <div className="no-records">
                    <p>No tax records found</p>
                    <button 
                      className="create-btn" 
                      onClick={() => setShowCreateModal(true)}
                    >
                      Create First Record
                    </button>
                  </div>
                ) : filteredRecords.map((record, index) => (
                  <div 
                    className={`record-item ${selectedRecord?.id === record.id ? "selected" : ""} ${record.isVerified ? "verified" : ""}`} 
                    key={index}
                    onClick={() => setSelectedRecord(record)}
                  >
                    <div className="record-title">{record.name}</div>
                    <div className="record-meta">
                      <span>Deduction: ${record.publicValue1}</span>
                      <span>Created: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="record-status">
                      Status: {record.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                      {record.isVerified && record.decryptedValue && (
                        <span className="verified-amount">Income: ${record.decryptedValue}</span>
                      )}
                    </div>
                    <div className="record-creator">Creator: {record.creator.substring(0, 6)}...{record.creator.substring(38)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>Tax Statistics & Analytics</h2>
            <div className="stats-grid">
              <div className="stat-card metal-panel">
                <h3>Total Tax Records</h3>
                <div className="stat-number">{taxRecords.length}</div>
              </div>
              <div className="stat-card metal-panel">
                <h3>Average Income</h3>
                <div className="stat-number">
                  ${taxRecords.length > 0 
                    ? Math.round(taxRecords.reduce((sum, r) => sum + (r.decryptedValue || 0), 0) / taxRecords.length)
                    : 0}
                </div>
              </div>
              <div className="stat-card metal-panel">
                <h3>Verification Rate</h3>
                <div className="stat-number">
                  {taxRecords.length > 0 
                    ? Math.round((taxRecords.filter(r => r.isVerified).length / taxRecords.length) * 100)
                    : 0}%
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-section">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-list">
              {faqItems.map((faq, index) => (
                <div 
                  key={index} 
                  className={`faq-item ${faqOpenIndex === index ? "open" : ""}`}
                  onClick={() => setFaqOpenIndex(faqOpenIndex === index ? null : index)}
                >
                  <div className="faq-question">
                    {faq.question}
                    <span className="faq-toggle">{faqOpenIndex === index ? "−" : "+"}</span>
                  </div>
                  {faqOpenIndex === index && (
                    <div className="faq-answer">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateRecord 
          onSubmit={createRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { 
            setSelectedRecord(null); 
            setDecryptedData({ income: null, deduction: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedRecord.income)}
          renderAnalysisChart={renderAnalysisChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRecord: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'income') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-record-modal">
        <div className="modal-header">
          <h2>New Tax Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Income data will be encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Record Name *</label>
            <input 
              type="text" 
              name="name" 
              value={recordData.name} 
              onChange={handleChange} 
              placeholder="Enter record name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Income Amount (Integer only) *</label>
            <input 
              type="number" 
              name="income" 
              value={recordData.income} 
              onChange={handleChange} 
              placeholder="Enter income amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Deduction Amount *</label>
            <input 
              type="number" 
              min="0" 
              name="deduction" 
              value={recordData.deduction} 
              onChange={handleChange} 
              placeholder="Enter deduction amount..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !recordData.name || !recordData.income || !recordData.deduction} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Record"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: TaxRecord;
  onClose: () => void;
  decryptedData: { income: number | null; deduction: number | null };
  setDecryptedData: (value: { income: number | null; deduction: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAnalysisChart: (record: TaxRecord, decryptedIncome: number | null, decryptedDeduction: number | null) => JSX.Element;
}> = ({ record, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderAnalysisChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.income !== null) { 
      setDecryptedData({ income: null, deduction: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ income: decrypted, deduction: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal">
        <div className="modal-header">
          <h2>Tax Record Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Record Name:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Deduction Amount:</span>
              <strong>${record.publicValue1}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Income Data</h3>
            
            <div className="data-row">
              <div className="data-label">Income Amount:</div>
              <div className="data-value">
                {record.isVerified && record.decryptedValue ? 
                  `$${record.decryptedValue} (Verified)` : 
                  decryptedData.income !== null ? 
                  `$${decryptedData.income} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(record.isVerified || decryptedData.income !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : record.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.income !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Privacy Protection</strong>
                <p>Income data is encrypted on-chain. Click to verify decryption using FHE technology.</p>
              </div>
            </div>
          </div>
          
          {(record.isVerified || decryptedData.income !== null) && (
            <div className="analysis-section">
              <h3>Tax Analysis</h3>
              {renderAnalysisChart(
                record, 
                record.isVerified ? record.decryptedValue || null : decryptedData.income, 
                null
              )}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Income Amount:</span>
                  <strong>
                    {record.isVerified ? 
                      `$${record.decryptedValue} (Verified)` : 
                      `$${decryptedData.income} (Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${record.isVerified ? 'verified' : 'local'}`}>
                    {record.isVerified ? 'Verified' : 'Local'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Deduction Amount:</span>
                  <strong>${record.publicValue1}</strong>
                  <span className="data-badge public">Public</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!record.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

