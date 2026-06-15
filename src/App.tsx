import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { Html5Qrcode } from 'html5-qrcode';
import JsBarcode from 'jsbarcode';
import {
  LayoutDashboard,
  Briefcase,
  UploadCloud,
  Boxes,
  PackageCheck,
  ScanLine,
  History,
  Shirt,
  MapPin,
  ShoppingCart,
  DollarSign,
  AlertOctagon,
  Activity,
  ChevronRight,
  ChevronLeft,
  Search,
  LogIn,
  LogOut,
  Check,
  ShieldCheck,
  FileSpreadsheet,
  Loader2,
  Camera,
  Download,
  AlertTriangle,
  RefreshCw,
  X,
  Edit2,
  Trash2,
  Plus
} from 'lucide-react';

import { 
  CatalogItem, 
  InventoryItem, 
  LocationItem, 
  OrderItem, 
  ActivityLog, 
  UserSession 
} from './types';

import {
  cleanBarcode,
  normalizeLocationId,
  extractBaseBarcode,
  getTokenKey,
  getProductCategory,
  getCategoryName
} from './utils/helpers';

import { AnalyticsCharts } from './components/AnalyticsCharts';

// Initialize live Supabase parallel connection
const supabase = createClient(
  "https://auwnaivrovqqmthmljvg.supabase.co",
  "sb_publishable_oHUfVrGohNstb9bUvNyS5A_YxsESG93"
);

export default function App() {
  // Authentication & session state
  const [session, setSession] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem('tree_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Date.now() - parsed.ts < 24 * 3600000) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  });

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState(false);

  // App routing
  const [activeTab, setActiveTab] = useState<'dashboard' | 'executive' | 'upload' | 'inventory' | 'picker' | 'query' | 'logs'>('dashboard');
  const [activeInventorySubTab, setActiveInventorySubTab] = useState<'stock' | 'catalog' | 'discrepancy' | 'map' | 'print'>('stock');

  // Live database collections
  const [liveInventory, setLiveInventory] = useState<InventoryItem[]>([]);
  const [liveCatalog, setLiveCatalog] = useState<CatalogItem[]>([]);
  const [liveLocations, setLiveLocations] = useState<LocationItem[]>([]);
  const [liveOrders, setLiveOrders] = useState<OrderItem[]>([]);
  const [liveLogs, setLiveLogs] = useState<ActivityLog[]>([]);

  // Page parameters & filters
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [selectedMapZone, setSelectedMapZone] = useState<"A" | "B" | "C" | "D" | "E">('A');
  const [selectedShelfNum, setSelectedShelfNum] = useState<number | null>(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryPage, setInventoryPage] = useState(1);
  const [activeEditRecord, setActiveEditRecord] = useState<InventoryItem | null>(null);

  // Barcode Printing State
  const [printLabelType, setPrintLabelType] = useState<'catalog' | 'locations' | 'shelves-az'>('catalog');
  const [printQuantities, setPrintQuantities] = useState<{ [key: string]: number }>({});
  const [printSearch, setPrintSearch] = useState('');

  // Scanner modal State
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerInstance, setScannerInstance] = useState<Html5Qrcode | null>(null);

  // Direct Barcode Query Search input
  const [queryInput, setQueryInput] = useState('');
  const [queryResult, setQueryResult] = useState<{
    product: CatalogItem | null;
    shelves: InventoryItem[];
    otherShelves: InventoryItem[];
    success: boolean;
    searched: boolean;
  }>({ product: null, shelves: [], otherShelves: [], success: false, searched: false });

  // Spreadsheet Upload States
  const [parsedFiles, setParsedFiles] = useState<{ [key: string]: any[] | null }>({
    catalog: null,
    shopify_images: null,
    locations: null,
    inventory: null,
    shopify_orders: null
  });
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: { active: boolean; pct: number } }>({});
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['[نظام] تم تشغيل محرك معالجة مستودع TREE الذكي.']);

  // Audit Logs pagination & search
  const [logsSearch, setLogsSearch] = useState('');
  const [logsTypeFilter, setLogsTypeFilter] = useState('all');
  const [logsPage, setLogsPage] = useState(1);

  // 1. O(1) MEMOIZED INDEX MAPS - Prevents any lags during rendering / scrolling!
  const catalogByBarcode = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    liveCatalog.forEach(item => {
      const clean = cleanBarcode(item.barcode);
      if (clean) map.set(clean, item);
    });
    return map;
  }, [liveCatalog]);

  const catalogByTokens = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    liveCatalog.forEach(item => {
      const clean = cleanBarcode(item.barcode);
      if (!clean) return;
      const tokens = getTokenKey(clean);
      if (tokens) map.set(tokens, item);
    });
    return map;
  }, [liveCatalog]);

  const catalogByBase = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    liveCatalog.forEach(item => {
      const clean = cleanBarcode(item.barcode);
      const base = extractBaseBarcode(clean);
      if (base && !map.has(base)) map.set(base, item);
    });
    return map;
  }, [liveCatalog]);

  const imagesByBase = useMemo(() => {
    const map = new Map<string, string>();
    liveCatalog.forEach(item => {
      const clean = cleanBarcode(item.barcode);
      const base = extractBaseBarcode(clean);
      if (base && !map.has(base) && item.image_url) {
        map.set(base, item.image_url);
      }
    });
    return map;
  }, [liveCatalog]);

  // Fast Category Lookups
  const productCategoryCache = useMemo(() => {
    const map = new Map<string, "A" | "B" | "C" | "D" | "E" >();
    liveCatalog.forEach(item => {
      map.set(item.barcode, getProductCategory(item.product_name));
    });
    return map;
  }, [liveCatalog]);

  // Fast O(1) Fetch helper
  const getProductCatalogItem = useCallback((barcode: string) => {
    if (!barcode) return null;
    const clean = cleanBarcode(barcode);
    let match = catalogByBarcode.get(clean);
    if (match) return match;

    const tokens = getTokenKey(clean);
    match = catalogByTokens.get(tokens);
    if (match) return match;

    const base = extractBaseBarcode(clean);
    return catalogByBase.get(base) || null;
  }, [catalogByBarcode, catalogByTokens, catalogByBase]);

  const getProductImage = useCallback((barcode: string) => {
    if (!barcode) return '';
    const item = getProductCatalogItem(barcode);
    if (item && item.image_url) return item.image_url;

    const clean = cleanBarcode(barcode);
    const base = extractBaseBarcode(clean);
    return imagesByBase.get(base) || '';
  }, [getProductCatalogItem, imagesByBase]);

  const getProductCategoryCached = useCallback((barcode: string) => {
    const item = getProductCatalogItem(barcode);
    if (!item) return "E";
    return productCategoryCache.get(item.barcode) || "E";
  }, [getProductCatalogItem, productCategoryCache]);

  // Grouped active inventory shelves mapped to barcode
  const inventoryShelvesByBarcode = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    liveInventory.forEach(item => {
      const clean = cleanBarcode(item.barcode);
      if (!clean) return;
      if (!map.has(clean)) map.set(clean, []);
      map.get(clean)!.push(item);
    });
    return map;
  }, [liveInventory]);

  const inventoryShelvesByBaseBarcode = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    liveInventory.forEach(item => {
      const clean = cleanBarcode(item.barcode);
      const base = extractBaseBarcode(clean);
      if (!base) return;
      if (!map.has(base)) map.set(base, []);
      map.get(base)!.push(item);
    });
    return map;
  }, [liveInventory]);

  const getShelvesForSku = useCallback((sku: string) => {
    const clean = cleanBarcode(sku);
    let shelves = inventoryShelvesByBarcode.get(clean) || [];
    if (shelves.length === 0) {
      const base = extractBaseBarcode(clean);
      shelves = inventoryShelvesByBaseBarcode.get(base) || [];
    }
    return shelves.filter(s => s.quantity > 0);
  }, [inventoryShelvesByBarcode, inventoryShelvesByBaseBarcode]);

  // Log write-back utility
  const logTerminal = useCallback((type: 'system' | 'success' | 'error', message: string) => {
    const timeStr = new Date().toLocaleTimeString('ar-EG', { hour12: false });
    const prefixes = { system: '[نظام]', success: '[نجاح]', error: '[خطأ]' };
    setTerminalLogs(prev => [...prev, `[${timeStr}] ${prefixes[type]} ${message}`]);
  }, []);

  const addActivityLog = async (action: string, details: string) => {
    try {
      await supabase.from('activity_logs').insert([{ action, details }]);
    } catch (_) {}
  };

  // 2. RETRIEVE ALL TABLES & INITIALIZE WEB SOCKET REAL-TIME SYNC
  useEffect(() => {
    if (!session) return;

    let ignore = false;
    let debounceTimer: any = null;
    
    async function loadAllData() {
      try {
        const [invRes, catRes, locRes, ordRes, logRes] = await Promise.all([
          supabase.from('warehouse_inventory').select('*'),
          supabase.from('products_catalog').select('*'),
          supabase.from('warehouse_locations').select('*'),
          supabase.from('shopify_orders').select('*'),
          supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(20)
        ]);

        if (ignore) return;
        setLiveInventory(invRes.data || []);
        setLiveCatalog(catRes.data || []);
        setLiveLocations(locRes.data || []);
        setLiveOrders(ordRes.data || []);
        setLiveLogs(logRes.data || []);
      } catch (_) {}
    }

    function triggerLoadDataDebounced() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadAllData();
      }, 300);
    }

    loadAllData();

    // Setup active parallel channels with debouncing
    const channelInst = supabase.channel('live-warehouse-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_inventory' }, () => triggerLoadDataDebounced())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products_catalog' }, () => triggerLoadDataDebounced())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_locations' }, () => triggerLoadDataDebounced())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopify_orders' }, () => triggerLoadDataDebounced())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, () => triggerLoadDataDebounced())
      .subscribe();

    return () => {
      ignore = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channelInst);
    };
  }, [session]);

  // Filter and paginate Branch layout choices
  const filteredBranchInventory = useMemo(() => {
    if (branchFilter === 'all') return liveInventory;
    return liveInventory.filter(item => item.location_id === branchFilter);
  }, [liveInventory, branchFilter]);

  const filteredBranchCatalog = useMemo(() => {
    if (branchFilter === 'all') return liveCatalog;
    const branchBarcodes = new Set(filteredBranchInventory.map(item => item.barcode));
    return liveCatalog.filter(item => branchBarcodes.has(item.barcode));
  }, [liveCatalog, filteredBranchInventory, branchFilter]);

  // Aggregate global statistics
  const topStats = useMemo(() => {
    const totalInventoryUnits = filteredBranchInventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const uniqueLocations = new Set(liveLocations.map(l => l.location_id));
    const pendingCount = liveOrders.filter(o => o.status === 'PENDING' || o.status === 'pending').length;

    return {
      totalInventoryUnits,
      catalogCount: filteredBranchCatalog.length,
      locationsCount: uniqueLocations.size,
      pendingOrders: pendingCount
    };
  }, [filteredBranchInventory, filteredBranchCatalog, liveLocations, liveOrders]);

  // Low Stock Items Memo Calculation
  const lowStockItemsList = useMemo(() => {
    const list: any[] = [];
    const qtyMap = new Map<string, number>();

    filteredBranchInventory.forEach(item => {
      qtyMap.set(item.barcode, (qtyMap.get(item.barcode) || 0) + Number(item.quantity || 0));
    });

    liveCatalog.forEach(item => {
      const physicalQty = qtyMap.get(item.barcode) || 0;
      if (physicalQty < lowStockThreshold) {
        list.push({
          barcode: item.barcode,
          name: item.product_name,
          systemQty: item.system_qty || 0,
          physicalQty: physicalQty
        });
      }
    });

    return list.slice(0, 16);
  }, [liveCatalog, filteredBranchInventory, lowStockThreshold]);

  // Dead Stock Items Memo Calculation (stocked but 0 Shopify orders)
  const deadStockItemsList = useMemo(() => {
    const orderedSkus = new Set<string>();
    liveOrders.forEach(o => {
      const lineitems = o.items || [];
      lineitems.forEach(item => {
        if (item.sku) orderedSkus.add(cleanBarcode(item.sku));
      });
    });

    const list: any[] = [];
    const qtyMap = new Map<string, number>();
    filteredBranchInventory.forEach(item => {
      qtyMap.set(item.barcode, (qtyMap.get(item.barcode) || 0) + Number(item.quantity || 0));
    });

    liveCatalog.forEach(item => {
      const cleanBC = cleanBarcode(item.barcode);
      if (!orderedSkus.has(cleanBC)) {
        const physicalQty = qtyMap.get(cleanBC) || 0;
        if (physicalQty > 0) {
          list.push({
            barcode: item.barcode,
            name: item.product_name,
            physicalQty: physicalQty
          });
        }
      }
    });

    return list.slice(0, 16);
  }, [liveCatalog, filteredBranchInventory, liveOrders]);

  // Discrepancy Items List Calculation
  const discrepanciesList = useMemo(() => {
    const list: any[] = [];
    const qtyMap = new Map<string, number>();

    filteredBranchInventory.forEach(item => {
      qtyMap.set(item.barcode, (qtyMap.get(item.barcode) || 0) + Number(item.quantity || 0));
    });

    const targetCatalog = branchFilter === 'all' ? liveCatalog : filteredBranchCatalog;

    targetCatalog.forEach(item => {
      const shelfQty = qtyMap.get(item.barcode) || 0;
      const diff = shelfQty - Number(item.system_qty || 0);
      if (diff !== 0) {
        list.push({
          barcode: item.barcode,
          productName: item.product_name || 'غير مسجل بالكتالوج',
          imageUrl: getProductImage(item.barcode),
          systemQty: Number(item.system_qty || 0),
          shelfQty: shelfQty,
          diff
        });
      }
    });

    return list;
  }, [liveCatalog, filteredBranchInventory, filteredBranchCatalog, branchFilter, getProductImage]);

  // 3. PAGINATING INVENTORY VIEW FOR EXTREME PERFORMANCE
  const activeTableRecords = useMemo(() => {
    const query = inventorySearch.toLowerCase().trim();

    if (activeInventorySubTab === 'stock') {
      const records = filteredBranchInventory;
      return query === '' 
        ? records 
        : records.filter(item => 
            item.barcode.toLowerCase().includes(query) || 
            item.location_id.toLowerCase().includes(query)
          );
    } 
    else if (activeInventorySubTab === 'catalog') {
      const records = filteredBranchCatalog;
      return query === '' 
        ? records 
        : records.filter(item => 
            item.barcode.toLowerCase().includes(query) || 
            item.product_name?.toLowerCase().includes(query)
          );
    } 
    else {
      // discrepancies view state
      const records = discrepanciesList;
      return query === '' 
        ? records 
        : records.filter(item => 
            item.barcode.toLowerCase().includes(query) || 
            item.productName.toLowerCase().includes(query)
          );
    }
  }, [activeInventorySubTab, filteredBranchInventory, filteredBranchCatalog, discrepanciesList, inventorySearch]);

  const paginatedTableRecords = useMemo(() => {
    const startIdx = (inventoryPage - 1) * 12;
    return activeTableRecords.slice(startIdx, startIdx + 12);
  }, [activeTableRecords, inventoryPage]);

  // Reset page when switching subtabs or searching
  useEffect(() => {
    setInventoryPage(1);
  }, [activeInventorySubTab, inventorySearch]);

  // Auth processing
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const formattedUsername = loginUsername.trim().toLowerCase();
    const formattedPin = loginPin.trim().toUpperCase();

    const USERS = [
      { username: 'admin',  password: 'TREE123', role: 'admin' as const,           branch: null },
      { username: 'branch', password: '21587',   role: 'branch_employee' as const, branch: null },
    ];

    let matchedUser = USERS.find(u => u.username === formattedUsername && u.password === formattedPin);
    if (!matchedUser && !formattedUsername) {
      matchedUser = USERS.find(u => u.password === formattedPin);
    }

    if (matchedUser) {
      const dummySession: UserSession = {
        username: matchedUser.username,
        role: matchedUser.role,
        branch: matchedUser.branch,
        ts: Date.now()
      };
      localStorage.setItem('tree_session', JSON.stringify(dummySession));
      setSession(dummySession);
      setLoginError(false);
      setLoginPin('');
      setLoginUsername('');
    } else {
      setLoginError(true);
      setLoginPin('');
    }
  };

  const handleLogout = () => {
    if (confirm('هل ترغب في الخروج من الحساب والعودة لشاشة الدخول؟')) {
      localStorage.removeItem('tree_session');
      setSession(null);
    }
  };

  // Direct Barcode query lookup
  const performBarcodeQuery = (code: string) => {
    const clean = cleanBarcode(code);
    if (!clean) return;

    const matchedProduct = getProductCatalogItem(clean);
    
    // Get location records from current branch or all branches
    const allLocations = liveInventory.filter(item => cleanBarcode(item.barcode) === clean || extractBaseBarcode(cleanBarcode(item.barcode)) === extractBaseBarcode(clean));
    
    const branchLocs = branchFilter === 'all' 
      ? allLocations 
      : allLocations.filter(item => item.location_id === branchFilter);

    const otherLocs = branchFilter === 'all' 
      ? [] 
      : allLocations.filter(item => item.location_id !== branchFilter);

    setQueryResult({
      product: matchedProduct,
      shelves: branchLocs,
      otherShelves: otherLocs,
      success: matchedProduct !== null || allLocations.length > 0,
      searched: true
    });
  };

  // Dynamic Camera Barcode scanner triggers
  const startCameraScan = async () => {
    setIsScannerOpen(true);
    setTimeout(() => {
      const qrcode = new Html5Qrcode("reader");
      qrcode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 120 } },
        (decodedText) => {
          setQueryInput(cleanBarcode(decodedText));
          performBarcodeQuery(decodedText);
          stopCameraScan();
        },
        () => {}
      ).then(() => {
        setScannerInstance(qrcode);
      }).catch(() => {
        alert("فشل تأمين الوصول للكاميرا، يرجى التحقق من الأذونات.");
        setIsScannerOpen(false);
      });
    }, 200);
  };

  const stopCameraScan = () => {
    if (scannerInstance) {
      scannerInstance.stop().then(() => {
        setScannerInstance(null);
      }).catch(() => {});
    }
    setIsScannerOpen(false);
  };

  // File spreadsheets processing
  const handleSpreadsheetDrop = (e: React.DragEvent, type: string) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length > 0) {
      processExcelFile(e.dataTransfer.files[0], type);
    }
  };

  const processExcelFile = (file: File, type: string) => {
    logTerminal('system', `قراءة ملف ${type}: ${file.name}`);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawJson: any[] = XLSX.utils.sheet_to_json(firstSheet);

        if (!rawJson || rawJson.length === 0) {
          alert("ملف جدول البيانات خالٍ من البيانات.");
          return;
        }

        // Map column headers intelligently
        const parsedRows = mapIncomingRows(rawJson, type);
        setParsedFiles(prev => ({ ...prev, [type]: parsedRows }));
        logTerminal('success', `تم تجهيز ${parsedRows.length} سجل من الملف بنجاح.`);
      } catch (err: any) {
        logTerminal('error', `فشل في تحليل الملف: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const mapIncomingRows = (json: any[], type: string): any[] => {
    if (type === 'shopify_orders') {
      const ordersMap: { [key: string]: OrderItem } = {};
      json.forEach(row => {
        const keys = Object.keys(row);
        const lookup = (arr: string[]) => {
          const key = keys.find(k => arr.includes(k.toLowerCase().replace(/[\s_-]/g, '')));
          return key ? row[key] : null;
        };

        const name = lookup(['name', 'order', 'ordernumber', 'رقمالطلب', 'الطلب']);
        const rawBarcode = lookup(['lineitemsku', 'sku', 'barcode', 'itemcode', 'الباركود', 'كودالقطعة']);
        const itemName = lookup(['lineitemname', 'itemname', 'name', 'title', 'المنتج', 'اسمالمنتج']);
        const quantity = lookup(['lineitemquantity', 'quantity', 'qty', 'الكمية', 'الكميةالمطلوبة']);
        const shippingName = lookup(['shippingname', 'customer', 'customername', 'العميل', 'اسم_العميل', 'اسمالعميل']);

        const cleanBC = cleanBarcode(rawBarcode);
        if (name && cleanBC && quantity) {
          const orderId = String(name).trim();
          if (!ordersMap[orderId]) {
            ordersMap[orderId] = {
              order_id: orderId,
              customer_name: shippingName ? String(shippingName).trim() : 'عميل شوبيفاي',
              status: 'PENDING',
              items: []
            };
          }
          const existing = ordersMap[orderId].items.find(i => i.sku === cleanBC);
          if (existing) {
            existing.quantity += Number(quantity);
          } else {
            ordersMap[orderId].items.push({
              sku: cleanBC,
              itemName: itemName ? String(itemName).trim() : 'منتج شوبيفاي',
              quantity: Number(quantity)
            });
          }
        }
      });
      return Object.values(ordersMap);
    }

    const items: any[] = [];
    json.forEach(row => {
      const keys = Object.keys(row);
      const lookup = (arr: string[]) => {
        const key = keys.find(k => arr.includes(k.toLowerCase().replace(/[\s_-]/g, '')));
        return key ? row[key] : null;
      };

      if (type === 'catalog') {
        const rawBarcode = lookup(['barcode', 'itemcode', 'upc', 'sku', 'code', 'الباركود', 'كودالصنف']);
        const productName = lookup(['productname', 'name', 'itemname', 'description', 'title', 'المنتج', 'اسمالمنتج', 'اسم_المنتج']);
        const systemQty = lookup(['systemqty', 'quantity', 'qty', 'count', 'amount', 'الكمية', 'الكمية_النظامية']);
        const imageUrl = lookup(['imageurl', 'image', 'img', 'رابطالصورة', 'رابط_الصورة']);
        
        const cleanBC = cleanBarcode(rawBarcode);
        if (cleanBC && productName) {
          items.push({
            barcode: cleanBC,
            product_name: String(productName).trim(),
            system_qty: systemQty !== null ? Number(systemQty) : 0,
            image_url: imageUrl ? String(imageUrl).trim() : ''
          });
        }
      } 
      else if (type === 'shopify_images') {
        const rawBarcode = lookup(['variantbarcode', 'barcode', 'sku', 'itemcode', 'الباركود', 'باركودالمنتج']);
        const imageSrc = lookup(['imagesrc', 'imageurl', 'image', 'src', 'img', 'رابطالصورة', 'الصورة', 'رابط_الصورة']);
        const title = lookup(['title', 'name', 'productname', 'المنتج', 'اسمالمنتج']);

        const cleanBC = cleanBarcode(rawBarcode);
        if (cleanBC && imageSrc) {
          items.push({
            barcode: cleanBC,
            image_url: String(imageSrc).trim(),
            product_name: title ? String(title).trim() : ''
          });
        }
      }
      else if (type === 'locations') {
        const id = lookup(['id', 'location', 'locationid', 'zone', 'shelf', 'الموقع']);
        if (id) {
          items.push({ location_id: normalizeLocationId(id) });
        }
      } 
      else if (type === 'inventory') {
        const rawBarcode = lookup(['barcode', 'itemcode', 'upc', 'sku', 'الباركود']);
        const locationId = lookup(['locationid', 'location', 'shelf', 'الموقع']);
        const quantity = lookup(['quantity', 'qty', 'count', 'amount', 'الكمية']);

        const cleanBC = cleanBarcode(rawBarcode);
        if (cleanBC && locationId) {
          items.push({
            barcode: cleanBC,
            location_id: normalizeLocationId(locationId),
            quantity: quantity !== null ? Number(quantity) : 0
          });
        }
      }
    });

    return items;
  };

  // Perform massive chunk upload to Supabase safely (prevent freezing)
  const syncFileWithSupabase = async (type: string) => {
    const data = parsedFiles[type];
    if (!data || data.length === 0) return;

    setUploadProgress(prev => ({ ...prev, [type]: { active: true, pct: 0 } }));
    logTerminal('system', `بدء ترحيل ورفع ${data.length} سجل إلى قاعدة البيانات...`);

    const batchLimit = 300;
    let processedCount = 0;

    try {
      const table = (type === 'catalog' || type === 'shopify_images') ? 'products_catalog' :
                    type === 'locations' ? 'warehouse_locations' :
                    type === 'inventory' ? 'warehouse_inventory' : 'shopify_orders';

      for (let i = 0; i < data.length; i += batchLimit) {
        const chunk = data.slice(i, i + batchLimit);
        
        let upsertRes;
        if (type === 'inventory') {
          // Unique keys composite override mapping
          upsertRes = await supabase.from(table).upsert(chunk, { onConflict: 'barcode,location_id' });
        } else if (type === 'shopify_orders') {
          upsertRes = await supabase.from(table).upsert(chunk, { onConflict: 'order_id' });
        } else {
          upsertRes = await supabase.from(table).upsert(chunk);
        }

        if (upsertRes.error) throw upsertRes.error;

        processedCount += chunk.length;
        const pctVal = Math.round((processedCount / data.length) * 100);
        setUploadProgress(prev => ({ ...prev, [type]: { active: true, pct: pctVal } }));
      }

      await addActivityLog(`رفع ملف ${type}`, `تم تحديث وترحيل عدد ${processedCount} سجل بنجاح.`);
      logTerminal('success', `اكتمل ترحيل الملف بالكامل وحفظت السجلات بقاعدة البيانات بنجاح.`);
      alert("اكتمل الرفع والترحيل لـ Supabase بنجاح!");
      
      setParsedFiles(prev => ({ ...prev, [type]: null }));
    } catch (err: any) {
      logTerminal('error', `فشل رفع السجلات: ${err.message}`);
      alert("حدث خطأ أثناء الرفع: " + err.message);
    } finally {
      setUploadProgress(prev => ({ ...prev, [type]: { active: false, pct: 0 } }));
    }
  };

  // Confirm and deduct Shopify orders on pick completion
  const handlePickOrderComplete = async (orderId: string) => {
    const orderItem = liveOrders.find(o => o.order_id === orderId);
    if (!orderItem) return;

    if (!confirm(`هل أنت متأكد من تحضير ورصد طلب العميل رقم ${orderId} وخصم القطع من الرفوف الفعلية؟`)) return;

    logTerminal('system', `بدأ خصم قطع الطلب ${orderId} وتعديل الرفوف...`);
    try {
      const updatesList: any[] = [];
      const lineitems = orderItem.items || [];

      for (const item of lineitems) {
        let neededQty = Number(item.quantity || 0);
        const shelves = getShelvesForSku(item.sku);

        for (const shelf of shelves) {
          if (neededQty <= 0) break;
          const currentQty = Number(shelf.quantity || 0);

          let newQty = 0;
          if (currentQty >= neededQty) {
            newQty = currentQty - neededQty;
            neededQty = 0;
          } else {
            neededQty -= currentQty;
            newQty = 0;
          }

          updatesList.push({
            id: shelf.id,
            barcode: shelf.barcode,
            location_id: shelf.location_id,
            quantity: newQty
          });
        }

        if (neededQty > 0) {
          logTerminal('error', `تنبيه: عجز رصيد بالرفوف للباركود ${item.sku} بمقدار ${neededQty} قطعة!`);
        }
      }

      if (updatesList.length > 0) {
        const invUpdate = await supabase.from('warehouse_inventory').upsert(updatesList);
        if (invUpdate.error) throw invUpdate.error;
      }

      const orderUpdate = await supabase.from('shopify_orders').update({ status: 'COMPLETED' }).eq('order_id', orderId);
      if (orderUpdate.error) throw orderUpdate.error;

      await addActivityLog("تحضير طلب شوبيفاي", `تم الانتهاء من الطلب رقم ${orderId} وخصم القطع من المخازن.`);
      logTerminal('success', `تم تحضير الطلب ${orderId} والخصم التلقائي بنجاح!`);
      alert(`اكتمل تحضير وتغليف أوردر رقم ${orderId} بنجاح.`);
    } catch (err: any) {
      logTerminal('error', `فشل تحديث الطلب: ${err.message}`);
    }
  };

  // Handwrite discrepancy issues direct to administrators
  const reportDeficitValue = async (barcode: string, systemQty: number) => {
    const userInput = prompt(`الرصيد الكتالوجي الحالي: ${systemQty}. يرجى إدخال الرصيد الفعلي المتواجد بالرف حرّاً:`);
    if (userInput === null || userInput.trim() === '') return;

    const actualQty = parseInt(userInput, 10);
    if (isNaN(actualQty) || actualQty < 0) {
      alert("الرجاء تحديد قيمة رقمية صحيحة.");
      return;
    }

    const diff = actualQty - systemQty;
    if (diff === 0) {
      alert("رصيدك مطابق للكتالوج.");
      return;
    }

    const confirmMsg = `هل ترغب في تسجيل بلاغ جرد عجز بالرف؟\nرقم الصنف: ${barcode}\nالرصيد الفعلي بالرف: ${actualQty}\nالفارق الجردي: ${diff > 0 ? '+' : ''}${diff}`;
    if (confirm(confirmMsg)) {
      try {
        const locDetails = branchFilter !== 'all' ? `بفرع ${branchFilter}` : '';
        await addActivityLog("تسجيل عجز بالرف", `بلاغ عجز للصنف ${barcode} ${locDetails} (النظام: ${systemQty}، الفعلي: ${actualQty})`);
        alert("تم إرسال وقبول بلاغ فروقات الجرد وسجل في الإدارة بنجاح.");
      } catch (_) {}
    }
  };

  // Edit shelf inventory value modal handlers
  const openEditModal = (item: InventoryItem) => {
    setActiveEditRecord(item);
  };

  const handleEditModalSave = async (newQty: number) => {
    if (!activeEditRecord) return;
    try {
      const updateRes = await supabase.from('warehouse_inventory')
        .update({ quantity: newQty })
        .eq('barcode', activeEditRecord.barcode)
        .eq('location_id', activeEditRecord.location_id);

      if (updateRes.error) throw updateRes.error;

      const modelItem = getProductCatalogItem(activeEditRecord.barcode);
      await addActivityLog("تعديل يدوي للمخزون", `تحديث رف ${activeEditRecord.location_id} للصنف (${modelItem?.product_name || activeEditRecord.barcode}) إلى ${newQty} قطعة.`);
      setActiveEditRecord(null);
    } catch (err: any) {
      alert("فشل تحديث الكمية: " + err.message);
    }
  };

  // Pre-generate virtual layout shelves A-Z for print preview list
  const virtualShelvesList = useMemo(() => {
    const list: string[] = [];
    for (let i = 65; i <= 90; i++) {
      const char = String.fromCharCode(i);
      for (let level = 1; level <= 5; level++) {
        list.push(`${char}-${level}`);
      }
    }
    return list;
  }, []);

  const printableItemsList = useMemo(() => {
    const query = printSearch.toLowerCase().trim();

    if (printLabelType === 'catalog') {
      return liveCatalog.filter(c => 
        c.barcode.toLowerCase().includes(query) || 
        c.product_name?.toLowerCase().includes(query)
      );
    } else if (printLabelType === 'locations') {
      return liveLocations.filter(l => l.location_id.toLowerCase().includes(query));
    } else {
      return virtualShelvesList.filter(s => s.toLowerCase().includes(query)).map(s => ({ location_id: s }));
    }
  }, [printLabelType, liveCatalog, liveLocations, virtualShelvesList, printSearch]);

  const triggerA4BarcodePrinting = () => {
    const printArea = document.getElementById('print-barcode-area');
    if (!printArea) return;

    printArea.innerHTML = '';
    let hasContents = false;

    Object.entries(printQuantities).forEach(([id, qty]) => {
      const qtyVal = Number(qty);
      if (isNaN(qtyVal) || qtyVal <= 0) return;
      hasContents = true;

      const itemCatalog = getProductCatalogItem(id);

      for (let index = 0; index < qtyVal; index++) {
        const card = document.createElement('div');
        card.className = 'barcode-print-card';

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute('id', `print-barcode-${id}-${index}`);
        card.appendChild(svg);

        const lbl = document.createElement('div');
        lbl.className = 'label-text';
        lbl.textContent = itemCatalog ? itemCatalog.product_name : `رف: ${id}`;
        card.appendChild(lbl);

        printArea.appendChild(card);

        // Generate immediate vector barcodes
        JsBarcode(svg, id, {
          format: "CODE128",
          width: 1.5,
          height: 38,
          displayValue: true,
          fontSize: 10,
          margin: 4
        });
      }
    });

    if (!hasContents) {
      alert("الرجاء تحديد كميات طباعة أكبر من 0 لأي من العناصر أولاً.");
      return;
    }

    window.print();
  };

  // Paginated and filtered Logs View lists
  const paginatedLogsList = useMemo(() => {
    let list = liveLogs;
    if (logsTypeFilter !== 'all') {
      list = list.filter(l => l.action === logsTypeFilter);
    }
    if (logsSearch.trim() !== '') {
      const q = logsSearch.toLowerCase().trim();
      list = list.filter(l => 
        (l.action && l.action.toLowerCase().includes(q)) || 
        (l.details && l.details.toLowerCase().includes(q))
      );
    }
    const startIdx = (logsPage - 1) * 14;
    return {
      total: list.length,
      items: list.slice(startIdx, startIdx + 14)
    };
  }, [liveLogs, logsTypeFilter, logsSearch, logsPage]);

  // Download Sample spreadsheets for seamless testing
  const downloadSpreadsheetSample = (type: string) => {
    let data: any[] = [];
    let namePath = '';

    if (type === 'catalog') {
      data = [
        { "Barcode": "8801097250041", "product_name": "تيشرت TREE قطن أوفرسايز - أسود M", "system_qty": 250, "image_url": "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=300" },
        { "Barcode": "8801097250058", "product_name": "تيشرت TREE قطن أوفرسايز - أسود L", "system_qty": 400, "image_url": "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=300" }
      ];
      namePath = 'TREE_Catalog_Sample.xlsx';
    } else if (type === 'locations') {
      data = [{ "id": "A-01" }, { "id": "A-02" }, { "id": "B-01" }];
      namePath = 'TREE_Locations_Sample.xlsx';
    } else if (type === 'inventory') {
      data = [
        { "Barcode": "8801097250041", "LocationId": "A-01", "Quantity": 150 },
        { "Barcode": "8801097250058", "LocationId": "B-01", "Quantity": 400 }
      ];
      namePath = 'TREE_Inventory_Sample.xlsx';
    } else {
      data = [
        { "Name": "#1001", "Lineitem sku": "8801097250041", "Lineitem name": "تيشرت TREE قطن أوفرسايز - أسود M", "Lineitem quantity": 2, "Shipping Name": "أحمد عبد الله" }
      ];
      namePath = 'TREE_Orders_Sample.xlsx';
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, namePath);
  };

  // Render Login overlay screen if not logged in
  if (!session) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-brand-deep p-4">
        <div className="w-full max-w-sm">
          {/* Logo & Brand */}
          <div className="flex flex-col items-center gap-3 mb-8 text-center">
            <div className="bg-white p-3 rounded-2xl shadow-2xl shadow-emerald-500/30 w-20 h-20 flex items-center justify-center overflow-hidden">
              <img src="logo.png" onError={(e) => { (e.target as HTMLImageElement).outerHTML = '<svg class="w-10 h-10 text-brand-deep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 0 1-2-1.92M12 22a10 10 0 0 0 2-1.92M12 22V12m0 0V2a10 10 0 0 1 2 1.92M14 6l6 2M12 12V2a10 10 0 0 0-2 1.92M10 6l-6 2M12 12l2.5-4h4.5M12 12l-2.5-4H5M12 12l-5.5 3h-.5M12 12l5.5 3h.5"></path></svg>'; }} alt="Logo" className="max-w-full max-h-full object-contain" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight uppercase leading-none font-sans">TREE Warehouse</h1>
              <p className="text-brand-300 text-xs mt-1 font-medium">نظام إدارة المخازن والفروع</p>
            </div>
          </div>

          {/* Login Card */}
          <form onSubmit={handleLogin} className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="text-white font-bold text-base mb-2 text-center">🔒 تسجيل الدخول</h2>

            <div>
              <label className="text-[11px] text-brand-200 font-bold block mb-1">اسم المستخدم</label>
              <input 
                type="text" 
                placeholder="admin" 
                value={loginUsername}
                onChange={e => setLoginUsername(e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white placeholder-brand-400 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-accent focus:bg-white/15 transition text-right"
              />
            </div>

            <div>
              <label className="text-[11px] text-brand-200 font-bold block mb-1">كلمة المرور / رمز الدخول</label>
              <input 
                type="password" 
                placeholder="أدخل كلمة المرور" 
                value={loginPin}
                onChange={e => setLoginPin(e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white placeholder-brand-400 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-accent focus:bg-white/15 transition text-right"
              />
            </div>

            {loginError && (
              <p className="text-rose-400 text-xs font-bold text-center">كلمة المرور غير صحيحة. حاول مرة أخرى.</p>
            )}

            <button type="submit" className="w-full bg-brand-accent hover:bg-emerald-400 text-brand-deep font-black py-3 rounded-xl text-sm transition-all shadow-lg flex items-center justify-center gap-2">
              <LogIn className="w-4 h-4" />
              دخول
            </button>
          </form>

          {/* Role hints */}
          <div className="mt-5 pt-4 border-t border-white/10 space-y-2">
            <p className="text-brand-300 text-[10px] font-bold uppercase tracking-wider text-center mb-1">أدوار الدخول</p>
            <div className="flex gap-2">
              <div className="flex-1 bg-white/5 rounded-lg p-2 text-center border border-white/5">
                <p className="text-white text-xs font-bold">مدير النظام</p>
                <p className="text-brand-300 text-[10px]">كل الصلاحيات</p>
              </div>
              <div className="flex-1 bg-white/5 rounded-lg p-2 text-center border border-white/5">
                <p className="text-white text-xs font-bold">موظف فرع</p>
                <p className="text-brand-300 text-[10px]">الاستعلام والمخزون</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row text-slate-900 bg-slate-50 font-sans" dir="rtl">
      
      {/* 1. SIDE NAVIGATION BAR */}
      <aside className="hidden md:flex w-64 bg-brand-deep text-white flex-col justify-between flex-shrink-0 border-l border-brand-900/30">
        <div>
          <div className="px-6 py-5 flex items-center gap-3 border-b border-brand-900/30">
            <div className="bg-white p-2 rounded-xl text-brand-deep flex items-center justify-center w-10 h-10 shadow-md">
              <Shirt className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight leading-none text-white font-sans">مستودع TREE</h1>
              <span className="text-[10px] text-brand-300 font-bold">بوابة اللوجستيات المتكاملة</span>
            </div>
          </div>

          <nav className="px-4 py-6 space-y-1">
            <button 
              onClick={() => setActiveTab('executive')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'executive' ? 'bg-brand-900/50 text-white shadow-inner' : 'text-brand-200 hover:text-white hover:bg-brand-900/30'}`}
            >
              <Briefcase className="w-5 h-5 flex-shrink-0" />
              الإدارة الإستراتيجية
            </button>

            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'dashboard' ? 'bg-brand-900/50 text-white shadow-inner' : 'text-brand-200 hover:text-white hover:bg-brand-900/30'}`}
            >
              <LayoutDashboard className="w-5 h-5 flex-shrink-0" />
              الرئيسية والمراجعات
            </button>

            <button 
              onClick={() => setActiveTab('upload')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'upload' ? 'bg-brand-900/50 text-white shadow-inner' : 'text-brand-200 hover:text-white hover:bg-brand-900/30'}`}
            >
              <UploadCloud className="w-5 h-5 flex-shrink-0" />
              مركز رفع جداول البيانات محلياً
            </button>

            <button 
              onClick={() => setActiveTab('inventory')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'inventory' ? 'bg-brand-900/50 text-white shadow-inner' : 'text-brand-200 hover:text-white hover:bg-brand-900/30'}`}
            >
              <Boxes className="w-5 h-5 flex-shrink-0" />
              المستودع والرفوف الحية
            </button>

            <button 
              onClick={() => setActiveTab('picker')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'picker' ? 'bg-brand-900/50 text-white shadow-inner' : 'text-brand-200 hover:text-white hover:bg-brand-900/30'}`}
            >
              <PackageCheck className="w-5 h-5 flex-shrink-0" />
              فرز وتعبئة طلبات شوبيفاي
            </button>

            <button 
              onClick={() => setActiveTab('query')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'query' ? 'bg-brand-900/50 text-white shadow-inner' : 'text-brand-200 hover:text-white hover:bg-brand-900/30'}`}
            >
              <ScanLine className="w-5 h-5 flex-shrink-0" />
              استعلام الباركود الفوري بالمستودع
            </button>

            <button 
              onClick={() => setActiveTab('logs')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${activeTab === 'logs' ? 'bg-brand-900/50 text-white shadow-inner' : 'text-brand-200 hover:text-white hover:bg-brand-900/30'}`}
            >
              <History className="w-5 h-5 flex-shrink-0" />
              بلاغات فروقات الجرد وحركات النظام
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-brand-900/40 pb-6 bg-brand-900/20">
          <div className="flex items-center justify-between text-xs mb-3 font-semibold text-brand-300">
            <span>مزامنة Supabase</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-400/25">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              نشط
            </span>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl hover:bg-rose-500 hover:text-white transition-all">
            <LogOut className="w-3.5 h-3.5" />
            خروج من الحساب
          </button>
        </div>
      </aside>

      {/* MOBILE FLOATING BAR NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-brand-deep border-t border-brand-900/30 text-white flex md:hidden justify-around items-center h-16 px-1 shadow-2xl">
        <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] font-bold ${activeTab === 'dashboard' ? 'text-brand-accent' : 'text-brand-200'}`}>
          <LayoutDashboard className="w-5 h-5" />
          <span>الرئيسية</span>
        </button>
        <button onClick={() => setActiveTab('inventory')} className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] font-bold ${activeTab === 'inventory' ? 'text-brand-accent' : 'text-brand-200'}`}>
          <Boxes className="w-5 h-5" />
          <span>المخزن</span>
        </button>
        <button onClick={() => setActiveTab('picker')} className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] font-bold ${activeTab === 'picker' ? 'text-brand-accent' : 'text-brand-200'}`}>
          <PackageCheck className="w-5 h-5" />
          <span>الفرز</span>
        </button>
        <button onClick={() => setActiveTab('query')} className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] font-bold ${activeTab === 'query' ? 'text-brand-accent' : 'text-brand-200'}`}>
          <ScanLine className="w-5 h-5" />
          <span>القارئ</span>
        </button>
        <button onClick={handleLogout} className="flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] font-bold text-rose-300">
          <LogOut className="w-5 h-5" />
          <span>خروج</span>
        </button>
      </nav>

      {/* 2. MAIN CORE LAYOUT CONTENT CONTAINER */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden relative pb-16 md:pb-0">
        
        {/* TOP LAYOUT HEADER */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-black text-slate-800">
              {activeTab === 'dashboard' && 'لوحة التحكم والمحاكاة اللوجستية'}
              {activeTab === 'executive' && 'اللوحة الإستراتيجية (Executive Hub)'}
              {activeTab === 'upload' && 'بوابة رفع ومزامنة البيانات اللوجستية (Supabase Pipeline)'}
              {activeTab === 'inventory' && 'المستودع والرفوف الحية ومطابقة الكتالوج'}
              {activeTab === 'picker' && 'شاشة فرز وتحضير طلبات شوبيفاي الفورية (Supabase Realtime)'}
              {activeTab === 'query' && 'الاستعلام الفوري والسريع للقطع بالمستودع'}
              {activeTab === 'logs' && 'بلاغات فروقات الجرد وسجل حركات النظام'}
            </h2>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Dynamic Local Filter Dropdown */}
            <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5">
              <MapPin className="w-4 h-4 text-brand-deep flex-shrink-0" />
              <select 
                value={branchFilter}
                onChange={e => {
                  setBranchFilter(e.target.value);
                  setInventoryPage(1);
                }}
                className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer min-w-[130px] border-none"
              >
                <option value="all">كل الفروع / المواقع</option>
                {Array.from(new Set(liveInventory.map(l => l.location_id))).sort().map(locId => (
                  <option key={locId} value={locId}>{locId}</option>
                ))}
              </select>
            </div>

            <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
              قاعدة البيانات: Supabase Cloud Live
            </div>
          </div>
        </header>

        {/* INNER SCROLLABLE TABS PORT */}
        <div id="tab-viewport-container" className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

          {/* ======================= EXECUTIVE STRATEGIC TAB ======================= */}
          {activeTab === 'executive' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-gradient-to-r from-emerald-950 to-brand-deep text-white rounded-3xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 border border-emerald-900/35">
                <div className="space-y-1.5 text-right">
                  <h3 className="text-xl md:text-2xl font-black text-brand-accent font-sans">نظام الإدارة اللوجستية الذكي</h3>
                  <p className="text-emerald-100 text-xs max-w-xl font-medium">
                    لوحة تحكم إستراتيجية تلخص صحة المخزون، وتكشف الأصناف الراكدة ونسب المبيعات بدقة تامة وبلا أي تأخر في معالجة البيانات.
                  </p>
                </div>
                <div className="bg-white/10 p-4 rounded-2xl border border-white/20 text-center min-w-[160px]">
                  <p className="text-[10px] text-brand-300 mb-1 font-bold">صحة الجرد الإجمالية</p>
                  <h4 className="text-3xl font-black text-brand-accent font-mono">
                    {Math.max(10, 100 - discrepanciesList.length)}%
                  </h4>
                </div>
              </div>

              {/* KPI metrics row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">قيمة مخزون التجزئة المقدر</span>
                    <h4 className="text-xl font-extrabold text-slate-800 font-mono mt-1">EGP {(topStats.totalInventoryUnits * 240).toLocaleString('ar-EG')}</h4>
                    <span className="text-[9px] text-emerald-600 font-semibold">متوفر بالرفوف الحالية</span>
                  </div>
                  <div className="bg-emerald-50 p-3 rounded-xl text-emerald-600"><DollarSign className="w-5 h-5" /></div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">بلاغات عجز الجرد المسجلة</span>
                    <h4 className="text-xl font-extrabold text-rose-600 font-mono mt-1">{discrepanciesList.length}</h4>
                    <span className="text-[9px] text-slate-400 font-semibold">تتطلب تسوية عاجلة بالرفوف</span>
                  </div>
                  <div className="bg-rose-50 p-3 rounded-xl text-rose-600"><AlertOctagon className="w-5 h-5" /></div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">عدد الموديلات الراكدة</span>
                    <h4 className="text-xl font-extrabold text-amber-600 font-mono mt-1">
                      {liveCatalog.filter(c => !liveOrders.some(o => o.items?.some(i => cleanBarcode(i.sku) === cleanBarcode(c.barcode)))).length} أصناف
                    </h4>
                    <span className="text-[9px] text-slate-400 font-semibold">لم تطلب في أي أوردرات شوبيفاي</span>
                  </div>
                  <div className="bg-amber-50 p-3 rounded-xl text-amber-600"><AlertTriangle className="w-5 h-5" /></div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">إجمالي كتل التحركات اليومية</span>
                    <h4 className="text-xl font-extrabold text-emerald-600 font-mono mt-1">{liveLogs.length} حركة</h4>
                    <span className="text-[9px] text-slate-400 font-semibold">مرصودة لحظياً بالخوادم</span>
                  </div>
                  <div className="bg-emerald-50 p-3 rounded-xl text-emerald-600"><Activity className="w-5 h-5" /></div>
                </div>
              </div>

              {/* Heatmap Layout Grid with 0(1) Cache optimization to prevent browser stutter */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">الكثافة اللوجستية وتوزيع البضائع</h4>
                    <p className="text-[10px] text-slate-400 font-semibold">توزيع رصيد جرد البضاعة الفعلي بفرعك الحالي لضمان منع التكدس العشوائي.</p>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-slate-100 border"></span> فارغ</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-amber-50 text-amber-700 border border-amber-100"></span> خفيف (1-50)</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-100"></span> متوسط (51-500)</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-brand-100 text-brand-900 border border-brand-200"></span> ممتاز (500+)</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {['A', 'B', 'C', 'D', 'E'].map(zone => {
                    const zoneItems = filteredBranchInventory.filter(item => getProductCategoryCached(item.barcode) === zone);
                    const totalQty = zoneItems.reduce((acc, i) => acc + Number(i.quantity || 0), 0);
                    
                    let bgClass = "bg-slate-50 border-slate-200 text-slate-400";
                    if (totalQty > 500) {
                      bgClass = "bg-brand-50 border-brand-200 text-brand-900 hover:bg-brand-100/40";
                    } else if (totalQty > 50) {
                      bgClass = "bg-emerald-50 border-emerald-200 text-emerald-850 hover:bg-emerald-100/40";
                    } else if (totalQty > 0) {
                      bgClass = "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100/40";
                    }

                    return (
                      <div 
                        key={zone} 
                        className={`p-4 rounded-xl border text-right space-y-1 justify-between flex flex-col transition h-24 ${bgClass}`}
                      >
                        <div className="text-xs font-bold text-slate-800">منطقة: {getCategoryName(zone as any).split(' ')[0]}</div>
                        <div className="flex justify-between items-baseline mt-2">
                          <span className="text-[10px] text-slate-400 font-bold">إجمالي القطع:</span>
                          <span className="text-base font-black font-mono">{totalQty.toLocaleString('ar-EG')}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ======================= GENERAL OVERVIEW TAB ======================= */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-fadeIn">
              
              {/* Marketing greeting */}
              <div className="bg-gradient-to-r from-brand-deep to-brand-700 text-white rounded-2xl p-6 shadow-xl shadow-brand-deep/10 flex flex-col md:flex-row items-center justify-between gap-6 border border-brand-900/35">
                <div className="space-y-2 text-right">
                  <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight">نظام لوجستيات TREE للملابس</h3>
                  <p className="text-brand-100 text-sm max-w-xl">
                    لوحة التحكم اللوجستية المخصصة لبراند الملابس TREE. متصلة حالياً بقاعدة بيانات **Supabase** لتخزين البضائع في الرفوف واستعلام المخزون وتوجيه عمال المخزن لتحضير طلبات شوبيفاي.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 flex-shrink-0">
                  <button onClick={() => setActiveTab('upload')} className="bg-brand-accent hover:bg-emerald-400 text-brand-deep font-bold text-xs md:text-sm px-4 md:px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 transition-all duration-200 flex items-center gap-2">
                    <UploadCloud className="w-4 h-4" />
                    مركز الرفع
                  </button>
                  <button onClick={() => setActiveTab('picker')} className="bg-white/10 hover:bg-white/20 text-white border border-white/20 font-bold text-xs md:text-sm px-4 md:px-5 py-2.5 rounded-xl transition-all duration-200 flex items-center gap-2">
                    <PackageCheck className="w-4 h-4" />
                    شاشة التحضير
                  </button>
                  <button onClick={() => setActiveTab('logs')} className="bg-white/10 hover:bg-white/20 text-white border border-white/20 font-bold text-xs md:text-sm px-4 md:px-5 py-2.5 rounded-xl transition-all duration-200 flex items-center gap-2">
                    <History className="w-4 h-4" />
                    سجل العمليات
                  </button>
                </div>
              </div>

              {/* KPIs indicators counters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Stat Card 1 */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition duration-200 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-500 font-semibold tracking-wide uppercase">أصناف الكتالوج</span>
                    <h4 className="text-3xl font-extrabold text-slate-800">{topStats.catalogCount.toLocaleString('ar-EG')}</h4>
                    <p className="text-[10px] text-slate-400 font-medium">موديلات ملابس مسجلة</p>
                  </div>
                  <div className="bg-emerald-50 p-4 rounded-xl text-brand-700">
                    <Shirt className="w-6 h-6" />
                  </div>
                </div>

                {/* Stat Card 2 */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition duration-200 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-500 font-semibold tracking-wide uppercase">رفوف التخزين</span>
                    <h4 className="text-3xl font-extrabold text-slate-800">{topStats.locationsCount.toLocaleString('ar-EG')}</h4>
                    <p className="text-[10px] text-slate-400 font-medium">موقعاً بالرفوف والممرات</p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-xl text-blue-600">
                    <MapPin className="w-6 h-6" />
                  </div>
                </div>

                {/* Stat Card 3 */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition duration-200 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-500 font-semibold tracking-wide uppercase">إجمالي القطع المودعة</span>
                    <h4 className="text-3xl font-extrabold text-slate-800">{topStats.totalInventoryUnits.toLocaleString('ar-EG')}</h4>
                    <p className="text-[10px] text-slate-400 font-medium">مجموع المخزون في الرفوف</p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-xl text-purple-600">
                    <Boxes className="w-6 h-6" />
                  </div>
                </div>

                {/* Stat Card 4 */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition duration-200 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-500 font-semibold tracking-wide uppercase">طلبات معلقة للتحضير</span>
                    <h4 className="text-3xl font-extrabold text-slate-800">{topStats.pendingOrders.toLocaleString('ar-EG')}</h4>
                    <p className="text-[10px] text-slate-400 font-medium">أوردرات شوبيفاي بانتظار الجمع</p>
                  </div>
                  <div className="bg-amber-50 p-4 rounded-xl text-amber-600">
                    <ShoppingCart className="w-6 h-6" />
                  </div>
                </div>
              </div>

              {/* Real-time O(1) Precached Analytics Charts widgets */}
              <AnalyticsCharts 
                filteredInventory={filteredBranchInventory}
                filteredCatalog={filteredBranchCatalog}
                catalogByBarcode={catalogByBarcode}
                activeBranchFilter={branchFilter}
              />

              {/* Alert panels for missing quantities (Low Stock and Dead Stock) */}
              {lowStockItemsList.length > 0 && (
                <div className="bg-white border border-rose-100 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="border-b border-rose-50 pb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-500 animate-pulse" />
                      <h4 className="text-xs font-bold text-slate-800">نواقص وتنبيهات مستويات أمان الرفوف</h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold">حد الأمان المطلوب:</span>
                      <input 
                        type="number" 
                        value={lowStockThreshold}
                        onChange={e => setLowStockThreshold(Math.max(1, Number(e.target.value)))}
                        className="w-12 px-1.5 py-0.5 border rounded text-xs text-center font-bold outline-none"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 max-h-[160px] overflow-y-auto pr-1">
                    {lowStockItemsList.map(item => (
                      <div key={item.barcode} className="p-2.5 bg-rose-50/40 rounded-xl border border-rose-150 flex items-center justify-between text-xs gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate" title={item.name}>{item.name}</p>
                          <span className="text-[9px] text-slate-400 font-mono">{item.barcode}</span>
                        </div>
                        <span className="px-2 py-0.5 rounded font-mono font-bold bg-rose-100 text-rose-700">رصيد: {item.physicalQty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deadStockItemsList.length > 0 && (
                <div className="bg-white border border-amber-100 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="border-b border-amber-50 pb-2 flex items-center gap-2">
                    <Boxes className="w-4 h-4 text-amber-500 animate-pulse" />
                    <h4 className="text-xs font-bold text-slate-800">الأصناف الراكدة بنسبة 100% (بضائع بالرفوف بلا مبيعات)</h4>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 max-h-[160px] overflow-y-auto pr-1">
                    {deadStockItemsList.map(item => (
                      <div key={item.barcode} className="p-2.5 bg-amber-50/20 rounded-xl border border-amber-100/40 flex items-center justify-between text-xs gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate" title={item.name}>{item.name}</p>
                          <span className="text-[9px] text-slate-400 font-mono">{item.barcode}</span>
                        </div>
                        <span className="px-2 py-0.5 rounded font-mono font-bold bg-amber-100 text-amber-700">مخزون: {item.physicalQty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================= CENTER CONTROL TAB UPLOADER ======================= */}
          {activeTab === 'upload' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">بوابة رفع ومزامنة البيانات اللوجستية (Excel)</h3>
                  <p className="text-[10px] text-slate-400 font-semibold mt-1">
                    قم بتحميل النماذج وتعبئتها بالكامل ومن ثم إسقاطها بمركز المزامنة لبدء الحفظ بـ Supabase.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => downloadSpreadsheetSample('catalog')} className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" /> نموذج الكتالوج
                  </button>
                  <button onClick={() => downloadSpreadsheetSample('inventory')} className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" /> نموذج التسكين
                  </button>
                </div>
              </div>

              {/* Grid with 5 dropzones for parallel file preparations */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                {[
                  { id: 'catalog', name: '1. كتالوج المنتجات', desc: 'تعريف المنتجات ومطابقة الباركود مع اسم الموديل والمخزون النظامي.' },
                  { id: 'shopify_images', name: '2. صور شوبيفاي', desc: 'ربط وتحديث صور الموديلات والقطع الفورية من شوبيفاي لربطها بالباركود.' },
                  { id: 'locations', name: '3. مواقع الرفوف', desc: 'إضافة وتفعيل معرفات الرفوف وأماكن الحفظ الفيزيائية داخل المستودع.' },
                  { id: 'inventory', name: '4. تسكين البضاعة', desc: 'توزيع الملابس وتخزين كمياتها الفعلية في مواقع الرفوف المحددة.' },
                  { id: 'shopify_orders', name: '5. طلبات شوبيفاي', desc: 'رفع قائمة طلبات العملاء اليومية لبدء الفرز والتوجيه لمواقع الرفوف لتحضيرها.' }
                ].map(card => {
                  const fileLoaded = parsedFiles[card.id] !== null;
                  const prog = uploadProgress[card.id];

                  return (
                    <div key={card.id} className="bg-white border rounded-2xl p-4 flex flex-col justify-between space-y-4 shadow-sm min-h-[220px]">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-brand-accent"></span>
                          <h4 className="text-xs font-bold text-slate-800">{card.name}</h4>
                        </div>
                        <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">{card.desc}</p>
                      </div>

                      {!fileLoaded ? (
                        <div 
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => handleSpreadsheetDrop(e, card.id)}
                          onClick={() => {
                            const input = document.getElementById(`input-file-${card.id}`);
                            input?.click();
                          }}
                          className="border-2 border-dashed border-slate-200 hover:border-brand-accent rounded-xl p-4 text-center cursor-pointer transition bg-slate-50/50 flex flex-col items-center justify-center min-h-[100px]"
                        >
                          <input 
                            type="file" 
                            id={`input-file-${card.id}`} 
                            accept=".xlsx, .xls, .csv" 
                            className="hidden" 
                            onChange={e => {
                              if (e.target.files && e.target.files.length > 0) {
                                processExcelFile(e.target.files[0], card.id);
                              }
                            }}
                          />
                          <UploadCloud className="w-5 h-5 text-slate-400 mb-1" />
                          <span className="text-[9px] font-bold text-slate-500">اسحب أو انقر لرفع الملف</span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100 flex items-center justify-between text-xs font-bold">
                            <span className="text-emerald-800 py-0.5 truncate max-w-[60%]">تم التحليل محلياً</span>
                            <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">{parsedFiles[card.id]?.length} سجل</span>
                          </div>

                          {prog?.active && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-[9px] font-bold">
                                <span className="text-slate-400">يرفع لـ Supabase...</span>
                                <span className="text-emerald-600">{prog.pct}%</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-emerald-600 h-1.5" style={{ width: `${prog.pct}%` }}></div>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-2 justify-end">
                            <button 
                              onClick={() => setParsedFiles(prev => ({ ...prev, [card.id]: null }))}
                              className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-2 py-1"
                            >
                              إلغاء
                            </button>
                            <button 
                              onClick={() => syncFileWithSupabase(card.id)}
                              disabled={prog?.active}
                              className="bg-brand-accent hover:bg-emerald-400 text-brand-deep font-black text-[10px] px-3 py-1.5 rounded-lg transition"
                            >
                              ترحيل ومزامنة
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Integrated system developer terminal console */}
              <div className="bg-slate-950 rounded-2xl p-5 font-mono text-xs text-slate-300 border border-slate-800 space-y-2.5 shadow-inner">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">سجل معالجة البيانات الفوري للـ Supabase Pipeline</span>
                  <button onClick={() => setTerminalLogs([])} className="text-[10px] text-slate-400 hover:text-white transition bg-slate-800 px-2 py-1 rounded-md">مسح الكونسول</button>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1 text-right">
                  {terminalLogs.map((log, index) => (
                    <div key={index} className="text-emerald-400/90 leading-relaxed font-mono">{log}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ======================= LIVE INVENTORY & SUBTABS TAB ======================= */}
          {activeTab === 'inventory' && (
            <div className="space-y-6 animate-fadeIn">
              {/* Flexible subtabs nested ports */}
              <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto scrollbar-none">
                {[
                  { id: 'stock', label: 'المخزون الفعلي بالمواقع' },
                  { id: 'catalog', label: 'كتالوج المنتجات والأسعار' },
                  { id: 'discrepancy', label: 'كاشف عجز وفروقات الجرد' },
                  { id: 'map', label: 'خريطة الرفوف التفاعلية' },
                  { id: 'print', label: 'طباعة باركود A4' }
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setActiveInventorySubTab(sub.id as any)}
                    className={`px-5 py-2.5 font-bold text-sm border-b-2 transition-all whitespace-nowrap ${activeInventorySubTab === sub.id ? 'border-brand-accent text-brand-deep font-extrabold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {/* Tab Search Filtering & Excel Exporter bars */}
              {activeInventorySubTab !== 'map' && activeInventorySubTab !== 'print' && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="relative w-full md:w-80">
                    <Search className="w-4 h-4 absolute right-3 top-3.5 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="ابحث بالباركود أو اسم المفرز أو الرف..."
                      value={inventorySearch}
                      onChange={e => setInventorySearch(e.target.value)}
                      className="w-full pr-9 pl-4 py-2 border rounded-xl text-xs font-bold outline-none border-slate-200 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-bold">إجمالي السجلات: {activeTableRecords.length}</span>
                  </div>
                </div>
              )}

              {/* 1. STOCKED INVENTORY OR CATALOG SUBTAB */}
              {(activeInventorySubTab === 'stock' || activeInventorySubTab === 'catalog' || activeInventorySubTab === 'discrepancy') && (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-right border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs font-bold">
                          {activeInventorySubTab === 'stock' && (
                            <>
                              <th className="px-6 py-4">الباركود</th>
                              <th className="px-6 py-4">رقم الرف والموقع</th>
                              <th className="px-6 py-4 text-center">الكمية المسكنة فعلياً</th>
                              <th className="px-6 py-4 text-left">التعديل اليدوي</th>
                            </>
                          )}
                          {activeInventorySubTab === 'catalog' && (
                            <>
                              <th className="px-6 py-4">الباركود</th>
                              <th className="px-6 py-4 text-right">الموديل والاسم</th>
                              <th className="px-6 py-4 text-center">الكمية النظامية الكلية</th>
                            </>
                          )}
                          {activeInventorySubTab === 'discrepancy' && (
                            <>
                              <th className="px-6 py-4">الباركود</th>
                              <th className="px-6 py-4 text-right">اسم الموديل</th>
                              <th className="px-6 py-4 text-center">الكمية النظامية</th>
                              <th className="px-6 py-4 text-center">الرصيد الفعلي بالرف</th>
                              <th className="px-6 py-4 text-left">الفارق الجردي</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                        {paginatedTableRecords.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-semibold">
                              لا توجد سجلات مطابقة في قاعدة البيانات.
                            </td>
                          </tr>
                        ) : (
                          paginatedTableRecords.map((item, index) => (
                            <tr key={index} className="hover:bg-slate-50/50 transition">
                              {activeInventorySubTab === 'stock' && (
                                <>
                                  <td className="px-6 py-4 font-mono font-bold">{item.barcode}</td>
                                  <td className="px-6 py-4 font-mono">
                                    <span className="inline-flex items-center gap-1 bg-slate-100 border text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold">📍 {item.location_id}</span>
                                  </td>
                                  <td className="px-6 py-4 font-mono font-bold text-center text-slate-900">{item.quantity.toLocaleString('ar-EG')} قطعة</td>
                                  <td className="px-6 py-4 text-left">
                                    <button 
                                      onClick={() => openEditModal(item)}
                                      className="text-brand-deep hover:text-emerald-800 font-bold text-[10px] bg-emerald-50 hover:bg-emerald-100/80 p-2 rounded-lg transition"
                                    >
                                      تعديل يدوياً
                                    </button>
                                  </td>
                                </>
                              )}
                              {activeInventorySubTab === 'catalog' && (
                                <>
                                  <td className="px-6 py-4 font-mono font-bold">{item.barcode}</td>
                                  <td className="px-6 py-4 font-bold text-slate-800 text-right">{item.product_name}</td>
                                  <td className="px-6 py-4 font-mono font-bold text-center text-slate-900">{Number(item.system_qty).toLocaleString('ar-EG')} قطعة</td>
                                </>
                              )}
                              {activeInventorySubTab === 'discrepancy' && (
                                <>
                                  <td className="px-6 py-4 font-mono font-bold">{item.barcode}</td>
                                  <td className="px-6 py-4 text-right font-bold text-slate-800">{item.productName}</td>
                                  <td className="px-6 py-4 font-mono font-bold text-center">{item.systemQty.toLocaleString('ar-EG')}</td>
                                  <td className="px-6 py-4 font-mono font-bold text-center">{item.shelfQty.toLocaleString('ar-EG')}</td>
                                  <td className="px-6 py-4 text-left">
                                    <span className={`inline-block px-2 py-0.5 rounded font-mono font-bold ${item.diff > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                                      {item.diff > 0 ? '+' : ''}{item.diff.toLocaleString('ar-EG')}
                                    </span>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination control footer bar */}
                  <div className="bg-slate-50 border-t border-slate-250 px-6 py-4 flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-500">يعرض {Math.min(activeTableRecords.length, (inventoryPage - 1) * 12 + 1)} - {Math.min(activeTableRecords.length, inventoryPage * 12)} من أصل {activeTableRecords.length} سجل</span>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setInventoryPage(prev => Math.max(1, prev - 1))}
                        disabled={inventoryPage === 1}
                        className="p-2 border rounded-xl hover:bg-white bg-slate-55 disabled:opacity-40 transition"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setInventoryPage(prev => prev + 1)}
                        disabled={inventoryPage * 12 >= activeTableRecords.length}
                        className="p-2 border rounded-xl hover:bg-white bg-slate-55 disabled:opacity-40 transition"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. INTERACTIVE VISUAL WAREHOUSE MAP */}
              {activeInventorySubTab === 'map' && (
                <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-6">
                  <div className="border-b pb-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h4 className="font-bold text-slate-800">التمثيل الجغرافي لرفوف المستودع (بصرياً)</h4>
                      <p className="text-[10px] text-slate-400 font-semibold mt-1">اختر المنطقة والمنفذ لعرض محتوياتها.</p>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {['A', 'B', 'C', 'D', 'E'].map(zone => (
                        <button
                          key={zone}
                          onClick={() => {
                            setSelectedMapZone(zone as any);
                            setSelectedShelfNum(null);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${selectedMapZone === zone ? 'bg-brand-accent text-brand-deep shadow-md' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                        >
                          المطبخ {zone} ({getCategoryName(zone as any).split(' ')[0]})
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Virtual shelves grid rendering */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(shelfNum => {
                      const shelfId = `الرف ${selectedMapZone}-${shelfNum}`;
                      const itemsOnShelf = filteredBranchInventory.filter((_, idx) => (idx % 6) + 1 === shelfNum && getProductCategoryCached(_.barcode) === selectedMapZone);
                      const totalQty = itemsOnShelf.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

                      let bgClass = "bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100/60";
                      if (totalQty > 500) {
                        bgClass = "bg-brand-100 border-brand-300 text-brand-900 hover:bg-brand-200/30";
                      } else if (totalQty > 50) {
                        bgClass = "bg-emerald-50 border-emerald-200 text-emerald-850 hover:bg-emerald-100/30";
                      } else if (totalQty > 0) {
                        bgClass = "bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100/30";
                      }

                      return (
                        <button
                          key={shelfNum}
                          onClick={() => setSelectedShelfNum(shelfNum)}
                          className={`p-5 rounded-2xl border text-center transition flex flex-col justify-between items-center h-28 space-y-1 shadow-sm ${bgClass}`}
                        >
                          <span className="text-xs font-black text-slate-800">{shelfId}</span>
                          <span className="text-[10px] font-bold text-slate-400 mt-2">مجموع القطع: {totalQty}</span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedShelfNum && (
                    <div className="bg-slate-50 p-4 border rounded-xl space-y-3">
                      <h5 className="text-xs font-bold text-slate-800">محتويات الرف المفتوح ({selectedMapZone}-{selectedShelfNum}):</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {filteredBranchInventory
                          .filter((_, idx) => (idx % 6) + 1 === selectedShelfNum && getProductCategoryCached(_.barcode) === selectedMapZone && _.quantity > 0)
                          .map((item, index) => {
                            const catalogItem = getProductCatalogItem(item.barcode);
                            return (
                              <div key={index} className="bg-white border p-3 rounded-lg flex items-center justify-between text-xs font-bold gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-slate-700">{catalogItem?.product_name || 'صنف عشوائي'}</p>
                                  <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{item.barcode}</span>
                                </div>
                                <span className="bg-slate-100 border px-1.5 py-0.5 rounded font-mono text-slate-700">{item.quantity}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 3. A4 BARCODE SHEETS PRINT SECTOR */}
              {activeInventorySubTab === 'print' && (
                <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
                  <div className="border-b pb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <h4 className="font-bold text-slate-800">توليد ملصقات باركود مصفوفة A4</h4>
                      <p className="text-[10px] text-slate-400 font-semibold mt-1">اختر نوع التوليد وعين الكتل واطبع بمسافات المقاييس.</p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <select 
                        value={printLabelType}
                        onChange={e => {
                          setPrintLabelType(e.target.value as any);
                          setPrintQuantities({});
                        }}
                        className="bg-slate-100 border text-xs font-bold px-3 py-2 rounded-xl focus:ring-1 focus:ring-brand-accent focus:outline-none"
                      >
                        <option value="catalog">ملصقات منتجات الكتالوج</option>
                        <option value="locations">ملصقات رفوف المستودع الفعلي</option>
                        <option value="shelves-az">ملصقات افتراضية A-Z (5 مستويات)</option>
                      </select>

                      <button 
                        onClick={triggerA4BarcodePrinting}
                        className="bg-brand-accent hover:bg-emerald-400 text-brand-deep font-bold text-xs px-4 py-2 rounded-xl transition shadow-sm"
                      >
                        بدء توليد ومعاينة الطباعة A4
                      </button>
                    </div>
                  </div>

                  {/* Filter printing input and controls */}
                  <div className="bg-slate-50 p-4 border rounded-xl flex flex-col sm:flex-row justify-between items-center gap-3">
                    <div className="relative w-full sm:w-72">
                      <Search className="w-4 h-4 absolute right-3 top-3.5 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="ابحث بالاسم أو الباركود لتعيين الطباعة..."
                        value={printSearch}
                        onChange={e => setPrintSearch(e.target.value)}
                        className="w-full pr-9 pl-4 py-2 bg-white text-xs border rounded-xl outline-none"
                      />
                    </div>

                    <button 
                      onClick={() => setPrintQuantities({})}
                      className="text-xs text-rose-500 hover:text-rose-600 font-bold"
                    >
                      تصفير كتل الطباعة بالكامل
                    </button>
                  </div>

                  {/* Selectable grid for print amounts configuration */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 max-h-[360px] overflow-y-auto pr-1">
                    {printableItemsList.slice(0, 100).map((item: any, idx) => {
                      const id = printLabelType === 'catalog' ? item.barcode : item.location_id;
                      const name = printLabelType === 'catalog' ? item.product_name : `رف: ${id}`;
                      const currentVal = printQuantities[id] || 0;

                      return (
                        <div key={idx} className="p-3 bg-white border rounded-xl shadow-sm text-xs space-y-3 justify-between flex flex-col h-28">
                          <div className="min-w-0">
                            <h5 className="font-bold text-slate-800 truncate" title={name}>{name}</h5>
                            <span className="text-[10px] text-slate-400 font-mono block mt-0.5 truncate">{id}</span>
                          </div>

                          <div className="flex items-center gap-2 justify-between">
                            <span className="text-[10px] text-slate-400 font-semibold">كمية المطبوعات:</span>
                            <div className="flex items-center gap-1.5">
                              <button 
                                onClick={() => setPrintQuantities(p => ({ ...p, [id]: Math.max(0, (p[id] || 0) - 1) }))}
                                className="w-6 h-6 border rounded hover:bg-slate-100 flex items-center justify-center font-bold"
                              >
                                -
                              </button>
                              <span className="text-xs font-black font-mono w-4 text-center">{currentVal}</span>
                              <button 
                                onClick={() => setPrintQuantities(p => ({ ...p, [id]: (p[id] || 0) + 1 }))}
                                className="w-6 h-6 border rounded hover:bg-slate-100 flex items-center justify-center font-bold"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================= SHOPIFY ORDER PICKER TAB =================------+ */}
          {activeTab === 'picker' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-white p-5 border rounded-2xl shadow-sm">
                <h3 className="text-sm font-bold text-slate-800">فرز وتجهيز طلبات شوبيفاي المفتوحة</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-1">
                  المسارات مرتبة جغرافياً حسب تسلسل الرفوف تلقائياً لسرعة جمع القطع وتفادي التحركات المهدرة.
                </p>
              </div>

              {liveOrders.filter(o => o.status === 'PENDING' || o.status === 'pending').length === 0 ? (
                <div className="bg-white border rounded-2xl p-16 text-center text-slate-400 font-semibold shadow-sm">
                  لا توجد طلبات معلقة بانتظار الفرز والتحضير حالياً.
                </div>
              ) : (
                <div className="space-y-4">
                  {liveOrders.filter(o => o.status === 'PENDING' || o.status === 'pending').map(order => (
                    <div key={order.order_id} className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                      <div className="bg-slate-50 border-b px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="text-xs text-slate-400 font-bold">المنتج رقم: <span className="text-brand-deep font-extrabold font-mono text-base">#{order.order_id}</span></div>
                          <p className="text-xs text-slate-500 font-bold">العميل: {order.customer_name || 'عميل شوبيفاي'}</p>
                        </div>

                        <button 
                          onClick={() => handlePickOrderComplete(order.order_id)}
                          className="bg-brand-accent text-brand-deep font-black text-xs px-4 py-2 rounded-xl transition duration-300 shadow-md hover:bg-emerald-400"
                        >
                          تأكيد جمع وتحديث الطلب
                        </button>
                      </div>

                      <div className="p-6 divide-y divide-slate-100">
                        {order.items?.map((item, index) => {
                          const shelves = getShelvesForSku(item.sku);
                          const imgUrl = getProductImage(item.sku);

                          return (
                            <div key={index} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                {imgUrl ? (
                                  <img src={imgUrl} className="w-12 h-12 rounded-xl object-cover shadow border bg-slate-50" />
                                ) : (
                                  <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-450 border"><Shirt className="w-6 h-6" /></div>
                                )}
                                <div>
                                  <p className="text-xs font-bold text-slate-800">{item.itemName || 'اسم صنف شوبيفاي'}</p>
                                  <span className="text-[10px] text-slate-400 font-mono">باركود: {item.sku} | كمية مطلوبة: <span className="font-extrabold text-slate-800">{item.quantity}</span></span>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-1.5 justify-start sm:justify-end">
                                {shelves.length === 0 ? (
                                  <span className="bg-rose-50 border border-rose-100 text-rose-700 font-bold px-2.5 py-1 rounded-lg text-[10px]">⚠️ غير رصيد أو مسجل بالرفوف</span>
                                ) : (
                                  shelves.map(s => (
                                    <span key={s.location_id} className="bg-emerald-50 text-emerald-800 border border-emerald-100 font-mono font-bold text-[10px] px-2.5 py-1 rounded-lg">
                                      📍 الرف: {s.location_id} (متاح {s.quantity})
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ======================= BARCODE DIRECT QUERY TAB ======================= */}
          {activeTab === 'query' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-white p-5 border rounded-2xl shadow-sm">
                <h3 className="text-sm font-bold text-slate-800">محدد ومطابق باركود الملابس فوريًا</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-1">كشف كامل على تفاصيل الصنف وخصائصه الجغرافية.</p>
              </div>

              <div className="bg-white p-6 border rounded-2xl shadow-sm flex flex-col md:flex-row items-center gap-3">
                <div className="relative flex-1 w-full">
                  <ScanLine className="w-5 h-5 absolute right-3.5 top-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="ضع المؤشر هنا وامسح بمسدس الباركود..."
                    value={queryInput}
                    onChange={e => setQueryInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        performBarcodeQuery(queryInput);
                      }
                    }}
                    className="w-full pr-11 py-3 text-sm font-bold border-2 rounded-2xl outline-none focus:border-brand-accent/80"
                  />
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                  <button 
                    onClick={() => performBarcodeQuery(queryInput)}
                    className="bg-brand-accent hover:bg-emerald-400 text-brand-deep font-bold text-xs px-6 py-3.5 rounded-2xl transition w-full md:w-auto text-center"
                  >
                    استعلام
                  </button>
                  <button 
                    onClick={startCameraScan}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-black text-xs px-4 py-3.5 rounded-2xl transition w-full md:w-auto flex items-center justify-center gap-1.5"
                  >
                    <Camera className="w-4 h-4" /> الكاميرا
                  </button>
                </div>
              </div>

              {queryResult.searched && (
                <div className="bg-white border rounded-2xl p-6 shadow-sm">
                  {queryResult.success ? (
                    <div className="flex flex-col sm:flex-row gap-6">
                      <div className="w-1/4 flex-shrink-0 flex items-center justify-center bg-slate-50 border p-3 rounded-2xl h-44">
                        {queryResult.product?.image_url ? (
                          <img src={queryResult.product.image_url} className="w-full h-full object-cover rounded-xl" />
                        ) : (
                          <Shirt className="w-16 h-16 text-slate-350" />
                        )}
                      </div>

                      <div className="flex-1 space-y-4">
                        <div>
                          <h4 className="text-base font-black text-slate-800">{queryResult.product?.product_name || 'ملبوسات TREE'}</h4>
                          <span className="text-xs text-slate-400 font-mono block mt-0.5">الباركود: {queryResult.product?.barcode || queryInput}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 border-y border-slate-100 py-3">
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold block mb-1">الكمية النظامية بالكتالوج:</span>
                            <span className="text-base font-black font-mono">{queryResult.product?.system_qty || 0}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold block mb-1 font-sans">الكمية الإجمالية بالرفوف:</span>
                            <span className="text-base font-black font-mono text-emerald-600">
                              {queryResult.shelves.reduce((s, i) => s + i.quantity, 0)}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b pb-1.5">
                            <span className="text-xs font-bold text-slate-600 block">أماكن ومواقع التسكين الحالية بالرفوف:</span>
                            <button
                              onClick={() => reportDeficitValue(queryResult.product?.barcode || queryInput, queryResult.product?.system_qty || 0)}
                              className="text-[10px] font-bold text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 px-3 py-1.5 rounded-lg flex items-center gap-1 animate-pulse"
                            >
                              <AlertOctagon className="w-3.5 h-3.5" /> تسجيل عجز بالرف
                            </button>
                          </div>
                          {queryResult.shelves.length === 0 ? (
                            <p className="text-xs text-rose-500 font-bold">هذا الموديل غير مسكن بأي رفوف حالياً.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                              {queryResult.shelves.map((sh, idx) => (
                                <div key={idx} className="bg-slate-50 border p-3 rounded-xl flex justify-between items-center text-xs font-bold">
                                  <span>📍 الرف/الموقع: {sh.location_id}</span>
                                  <span>الكمية: {sh.quantity} قطعة</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {queryResult.otherShelves.length > 0 && (
                            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                              <span className="text-[10px] text-slate-400 font-bold block">متوفر أيضاً في فروع أخرى:</span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {queryResult.otherShelves.map((sh, idx) => (
                                  <div key={idx} className="bg-amber-50/40 border border-amber-100/40 p-2.5 rounded-xl flex justify-between items-center text-[11px] text-slate-700">
                                    <span>🏪 فرع: {sh.location_id}</span>
                                    <span className="font-bold">رصيد: {sh.quantity}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-rose-500 font-bold text-sm">
                      لم يتم العثور على أي معلومات مسجلة للباركود المدخل: {queryInput}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ======================= AUDIT TRAIL LOGS TAB ======================= */}
          {activeTab === 'logs' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-white p-5 border rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 font-sans">سجلات حركات وفروق الجرد التفصيلي</h3>
                  <p className="text-[10px] text-slate-400 font-semibold mt-1">
                    تابع كافة الأوردرات والبلاغات وتعديلات المخازن بالتاريخ لضمان الضبط والإنتاجية.
                  </p>
                </div>
              </div>

              {/* Filtering layout for log movements */}
              <div className="bg-white border rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
                <div className="relative w-full md:w-80">
                  <Search className="w-4 h-4 absolute right-3 top-3.5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="ابحث بتفاصيل السجلات..."
                    value={logsSearch}
                    onChange={e => {
                      setLogsSearch(e.target.value);
                      setLogsPage(1);
                    }}
                    className="w-full pr-9 pl-4 py-2 border rounded-xl text-xs font-bold outline-none"
                  />
                </div>

                <select 
                  value={logsTypeFilter}
                  onChange={e => {
                    setLogsTypeFilter(e.target.value);
                    setLogsPage(1);
                  }}
                  className="bg-slate-100 border text-xs font-bold px-3 py-2 rounded-xl focus:outline-none"
                >
                  <option value="all">كل الحركات</option>
                  <option value="تعديل يدوي للمخزون">التعديل اليدوي للمخزون</option>
                  <option value="رفع ملف catalog">رفع ملف الكتالوج</option>
                  <option value="رفع ملف locations">رفع ملف المواقع</option>
                  <option value="رفع ملف inventory">رفع ملف التسكين</option>
                  <option value="تحضير طلب شوبيفاي">تحضير أوردرات شوبيفاي</option>
                  <option value="تسجيل عجز بالرف">بلاغات عجز الجرد</option>
                </select>
              </div>

              <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs font-bold">
                        <th className="px-6 py-4">التاريخ والوقت</th>
                        <th className="px-6 py-4">نوع الحركة</th>
                        <th className="px-6 py-4 text-right">تفاصيل العملية والبيانات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                      {paginatedLogsList.items.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-6 py-12 text-center text-slate-400 font-bold">
                            لا توجد حركات مسجلة مطابقة للخيارات.
                          </td>
                        </tr>
                      ) : (
                        paginatedLogsList.items.map((log, idx) => {
                          const rawTime = log.created_at || log.timestamp || '';
                          const dateStr = rawTime 
                            ? new Date(rawTime).toLocaleString('ar-EG', { hour12: false }) 
                            : '-';

                          let badgeColor = 'bg-slate-100 text-slate-700';
                          if (log.action.includes('رفع')) badgeColor = 'bg-emerald-50 text-emerald-800 border border-emerald-100';
                          else if (log.action.includes('عجز') || log.action.includes('بلاغ')) badgeColor = 'bg-rose-50 text-rose-800 border border-rose-100';
                          else if (log.action.includes('تعديل')) badgeColor = 'bg-emerald-50 text-emerald-800 border border-emerald-100';

                          return (
                            <tr key={idx} className="hover:bg-slate-50/50 transition">
                              <td className="px-6 py-4 font-mono text-slate-400 leading-none">{dateStr}</td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${badgeColor}`}>{log.action}</span>
                              </td>
                              <td className="px-6 py-4 font-bold text-slate-700 text-right">{log.details}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {paginatedLogsList.total > 0 && (
                  <div className="bg-slate-50 border-t px-6 py-4 flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-500">يعرض {Math.min(paginatedLogsList.total, (logsPage - 1) * 14 + 1)} - {Math.min(paginatedLogsList.total, logsPage * 14)} من أصل {paginatedLogsList.total} حركة</span>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setLogsPage(prev => Math.max(1, prev - 1))}
                        disabled={logsPage === 1}
                        className="p-2 border rounded-xl hover:bg-white bg-slate-55 disabled:opacity-40 transition"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setLogsPage(prev => prev + 1)}
                        disabled={logsPage * 14 >= paginatedLogsList.total}
                        className="p-2 border rounded-xl hover:bg-white bg-slate-55 disabled:opacity-40 transition"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Manual Quantity adjustment modal */}
      {activeEditRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 border border-slate-200 shadow-2xl relative text-right" dir="rtl">
            <div className="flex items-center justify-between border-b pb-3.5">
              <h4 className="font-black text-slate-800 text-xs text-right">✏️ تعديل الرصيد الفعلي بالرف يدوياً</h4>
              <button onClick={() => setActiveEditRecord(null)} className="text-slate-400 hover:text-slate-650">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-100/60 p-3.5 rounded-xl border border-slate-150 text-right">
                <span className="text-[10px] text-slate-400 font-bold block">الباركود</span>
                <p className="font-mono font-bold text-xs mt-0.5">{activeEditRecord.barcode}</p>
                <span className="text-[10px] text-slate-400 font-bold block mt-2.5">الموقع الفعلي</span>
                <p className="font-mono font-bold text-xs mt-0.5 text-brand-deep">{activeEditRecord.location_id}</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 block">الكمية المسكنة الحقيقية بالرف:</label>
                <input 
                  type="number"
                  defaultValue={activeEditRecord.quantity}
                  id="modal-edit-qty-input"
                  className="w-full text-center py-2.5 text-base border-2 font-black rounded-xl focus:border-brand-accent/85 outline-none"
                />
              </div>

              <div className="flex gap-2 justify-end pt-3 text-xs font-bold border-t">
                <button 
                  onClick={() => setActiveEditRecord(null)}
                  className="px-4 py-2 border rounded-xl hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button 
                  onClick={() => {
                    const inputVal = Number((document.getElementById('modal-edit-qty-input') as HTMLInputElement)?.value);
                    if (!isNaN(inputVal) && inputVal >= 0) {
                      handleEditModalSave(inputVal);
                    }
                  }}
                  className="bg-brand-accent text-brand-deep font-bold px-4 py-2 rounded-xl hover:bg-emerald-400 transition"
                >
                  حفظ التعديلات
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating camera barcode scanner container portal */}
      {isScannerOpen && (
        <div className="fixed inset-0 z-[210] bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-800 text-xs">📷 المسح الضوئي بكاميرا الجوال</h3>
              <button onClick={stopCameraScan} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative bg-black rounded-2xl overflow-hidden aspect-video border">
              <div id="reader" className="w-full h-full"></div>
            </div>
            <p className="text-center text-[10px] text-slate-400 font-bold">ضع الكود المربع أو الخطي داخل الحدود للكشف الفوري.</p>
          </div>
        </div>
      )}

      {/* Print Barcoding output portal optimizing for A4 layout spacing */}
      <div id="print-barcode-area"></div>
    </div>
  );
}
