import React, { useMemo } from 'react';
import { CatalogItem, InventoryItem } from '../types';
import { getProductCategory, getCategoryName } from '../utils/helpers';

interface ChartsProps {
  filteredInventory: InventoryItem[];
  filteredCatalog: CatalogItem[];
  catalogByBarcode: Map<string, CatalogItem>;
  activeBranchFilter: string;
}

export const AnalyticsCharts: React.FC<ChartsProps> = ({
  filteredInventory,
  filteredCatalog,
  catalogByBarcode,
  activeBranchFilter,
}) => {
  // 1. Calculate stock distribution per zone or per category if a single branch is selected
  const zoneDistribution = useMemo(() => {
    const counts: { [key: string]: number } = {};
    const isAll = activeBranchFilter === 'all';
    
    filteredInventory.forEach(item => {
      let key = 'غير محدد';
      if (isAll) {
        key = item.location_id || 'غير محدد';
      } else {
        const catalogItem = catalogByBarcode.get(item.barcode);
        const cat = getProductCategory(catalogItem?.product_name || '');
        key = getCategoryName(cat);
      }
      counts[key] = (counts[key] || 0) + Number(item.quantity || 0);
    });

    const total = Object.values(counts).reduce((acc, c) => acc + c, 0);

    return Object.entries(counts)
      .map(([label, qty]) => ({
        label,
        qty,
        percentage: total > 0 ? Math.round((qty / total) * 100) : 0,
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [filteredInventory, activeBranchFilter, catalogByBarcode]);

  // 2. Calculate Top 5 most stocked items
  const topStockedItems = useMemo(() => {
    const skuQtyMap = new Map<string, number>();
    filteredInventory.forEach(item => {
      skuQtyMap.set(item.barcode, (skuQtyMap.get(item.barcode) || 0) + Number(item.quantity || 0));
    });

    const sorted = Array.from(skuQtyMap.entries())
      .map(([barcode, qty]) => {
        const catalogItem = catalogByBarcode.get(barcode);
        const name = catalogItem ? catalogItem.product_name : barcode;
        return {
          name,
          barcode,
          qty,
        };
      })
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    const maxQty = sorted.length > 0 ? Math.max(...sorted.map(s => s.qty)) : 1;

    return sorted.map(item => ({
      ...item,
      ratio: Math.min(100, Math.round((item.qty / maxQty) * 100)),
    }));
  }, [filteredInventory, catalogByBarcode]);

  // Color cycles for distribution display
  const colorClasses = [
    'bg-brand-deep',
    'bg-teal-500',
    'bg-emerald-600',
    'bg-brand-accent',
    'bg-amber-500',
    'bg-rose-500',
    'bg-purple-500',
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Chart 1: Stock Distribution */}
      <div id="chart-distribution" className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
        <div className="border-b border-slate-100 pb-3 mb-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-accent"></span>
            توزيع رصيد المخزون على فروع ومناطق TREE
          </h4>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">مقسم تلقائياً بناءً على تكرار رصد الكميات بالرفوف</p>
        </div>

        {zoneDistribution.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-slate-400 text-xs font-semibold">
            لا توجد مخزونات مسجلة كافية لعرض نسب التوزيع.
          </div>
        ) : (
          <div className="space-y-4 max-h-[240px] overflow-y-auto pr-1">
            {zoneDistribution.map((z, index) => {
              const color = colorClasses[index % colorClasses.length];
              return (
                <div key={z.label} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold text-slate-700">
                    <span className="truncate max-w-[70%]">{z.label}</span>
                    <span className="font-mono text-slate-500 flex items-center gap-1.5">
                      <span>{z.qty.toLocaleString('ar-EG')} قطعة</span>
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] text-slate-600 font-bold">{z.percentage}%</span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex">
                    <div className={`${color} h-full rounded-full transition-all duration-300`} style={{ width: `${z.percentage}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Chart 2: Top Stocked Items */}
      <div id="chart-top-stocked" className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
        <div className="border-b border-slate-100 pb-3 mb-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
            أعلى 5 موديلات ملابس متوفرة بالمستودع
          </h4>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">الأصناف الأكثر وفرة بالعدد الفعلي وتسكين الرفوف</p>
        </div>

        {topStockedItems.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-slate-400 text-xs font-semibold">
            لا توجد كميات مضافة لعرض أعلى الموديلات وفرة.
          </div>
        ) : (
          <div className="space-y-4 max-h-[240px] overflow-y-auto pr-1">
            {topStockedItems.map((item, index) => (
              <div key={item.barcode} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-slate-800 truncate max-w-[65%]">{item.name}</span>
                  <span className="font-mono text-slate-500 font-bold">{item.qty.toLocaleString('ar-EG')} قطعة</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex">
                  <div className="bg-brand-deep h-full rounded-full transition-all duration-300" style={{ width: `${item.ratio}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
