import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { year, monthlySales, prevYearSales, topCustomers, topProducts, regionData, seasonData, totals } = body;

    // Dynamically import ExcelJS
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Advance HQ';

    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2D3748' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const currencyFmt = '$#,##0.00';
    const numberFmt = '#,##0';
    const pctFmt = '0.0%';

    // ── Sheet 1: Summary ──
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: '', width: 20 },
      { header: '', width: 20 },
      { header: '', width: 15 },
    ];

    summary.addRow(['Sales & Revenue Report', '', '']);
    summary.getRow(1).font = { bold: true, size: 16 };
    summary.addRow([`Year: ${year}`, '', '']);
    summary.addRow(['Generated:', new Date().toLocaleDateString(), '']);
    summary.addRow([]);

    summary.addRow(['Key Metrics', '', '']);
    summary.getRow(5).font = { bold: true, size: 13 };
    summary.addRow(['Total Revenue', totals.totalRevenue]);
    summary.getCell('B6').numFmt = currencyFmt;
    summary.addRow(['Total Orders', totals.totalOrders]);
    summary.getCell('B7').numFmt = numberFmt;
    summary.addRow(['Total Units', totals.totalUnits]);
    summary.getCell('B8').numFmt = numberFmt;
    summary.addRow(['Avg Order Value', totals.avgOrderValue]);
    summary.getCell('B9').numFmt = currencyFmt;
    summary.addRow(['Prior Year Revenue', totals.prevYearRevenue]);
    summary.getCell('B10').numFmt = currencyFmt;
    const yoyChange = totals.prevYearRevenue > 0 ? (totals.totalRevenue - totals.prevYearRevenue) / totals.prevYearRevenue : 0;
    summary.addRow(['YoY Change', yoyChange]);
    summary.getCell('B11').numFmt = pctFmt;

    // ── Sheet 2: Monthly Revenue ──
    const monthly = workbook.addWorksheet('Monthly Revenue');
    const monthHeaders = ['Month', `${year} Revenue`, `${year} Orders`, `${year} Units`, `${year} Avg Order`, `${parseInt(year) - 1} Revenue`, `${parseInt(year) - 1} Orders`, 'YoY Change'];
    const monthHeaderRow = monthly.addRow(monthHeaders);
    monthHeaderRow.eachCell((cell: any) => { cell.fill = headerFill; cell.font = headerFont; });
    monthly.columns = [
      { width: 10 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 14 }
    ];

    (monthlySales || []).forEach((m: any, i: number) => {
      const prev = prevYearSales?.[i]?.revenue || 0;
      const change = prev > 0 ? (m.revenue - prev) / prev : 0;
      const row = monthly.addRow([m.month, m.revenue, m.orders, m.units, m.avg_order, prev, prevYearSales?.[i]?.orders || 0, change]);
      [2, 5].forEach(c => { row.getCell(c).numFmt = currencyFmt; });
      row.getCell(5).numFmt = currencyFmt;
      [3, 4, 7].forEach(c => { row.getCell(c).numFmt = numberFmt; });
      row.getCell(8).numFmt = pctFmt;
    });

    // Totals row
    const totRow = monthly.addRow(['TOTAL', totals.totalRevenue, totals.totalOrders, totals.totalUnits, totals.avgOrderValue, totals.prevYearRevenue, '', yoyChange]);
    totRow.font = { bold: true };
    [2, 5, 6].forEach(c => { totRow.getCell(c).numFmt = currencyFmt; });
    totRow.getCell(5).numFmt = currencyFmt;
    [3, 4].forEach(c => { totRow.getCell(c).numFmt = numberFmt; });
    totRow.getCell(8).numFmt = pctFmt;

    // ── Sheet 3: Top Customers ──
    const custSheet = workbook.addWorksheet('Top Customers');
    const custHeaders = ['Rank', 'Customer', 'Revenue', 'Orders', 'Units', 'Avg Order', '% of Total'];
    const custHeaderRow = custSheet.addRow(custHeaders);
    custHeaderRow.eachCell((cell: any) => { cell.fill = headerFill; cell.font = headerFont; });
    custSheet.columns = [{ width: 8 }, { width: 40 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 }];

    (topCustomers || []).forEach((c: any, i: number) => {
      const row = custSheet.addRow([i + 1, c.name, c.revenue, c.orders, c.units, c.avg_order, totals.totalRevenue > 0 ? c.revenue / totals.totalRevenue : 0]);
      [3, 6].forEach(col => { row.getCell(col).numFmt = currencyFmt; });
      [4, 5].forEach(col => { row.getCell(col).numFmt = numberFmt; });
      row.getCell(7).numFmt = pctFmt;
    });

    // ── Sheet 4: Top Products ──
    const prodSheet = workbook.addWorksheet('Top Products');
    const prodHeaders = ['Rank', 'Style', 'Description', 'Revenue', 'Units', '% of Total'];
    const prodHeaderRow = prodSheet.addRow(prodHeaders);
    prodHeaderRow.eachCell((cell: any) => { cell.fill = headerFill; cell.font = headerFont; });
    prodSheet.columns = [{ width: 8 }, { width: 16 }, { width: 40 }, { width: 16 }, { width: 12 }, { width: 12 }];

    (topProducts || []).forEach((p: any, i: number) => {
      const row = prodSheet.addRow([i + 1, p.style, p.description, p.revenue, p.units, totals.totalRevenue > 0 ? p.revenue / totals.totalRevenue : 0]);
      row.getCell(4).numFmt = currencyFmt;
      row.getCell(5).numFmt = numberFmt;
      row.getCell(6).numFmt = pctFmt;
    });

    // ── Sheet 5: Revenue by State ──
    const stateSheet = workbook.addWorksheet('Revenue by State');
    const stateHeaders = ['State', 'Revenue', 'Orders', '% of Total'];
    const stateHeaderRow = stateSheet.addRow(stateHeaders);
    stateHeaderRow.eachCell((cell: any) => { cell.fill = headerFill; cell.font = headerFont; });
    stateSheet.columns = [{ width: 12 }, { width: 16 }, { width: 12 }, { width: 12 }];

    (regionData || []).forEach((r: any) => {
      const row = stateSheet.addRow([r.state, r.revenue, r.orders, totals.totalRevenue > 0 ? r.revenue / totals.totalRevenue : 0]);
      row.getCell(2).numFmt = currencyFmt;
      row.getCell(3).numFmt = numberFmt;
      row.getCell(4).numFmt = pctFmt;
    });

    // ── Sheet 6: Revenue by Season ──
    const seasSheet = workbook.addWorksheet('Revenue by Season');
    const seasHeaders = ['Season', 'Revenue', 'Orders', 'Units'];
    const seasHeaderRow = seasSheet.addRow(seasHeaders);
    seasHeaderRow.eachCell((cell: any) => { cell.fill = headerFill; cell.font = headerFont; });
    seasSheet.columns = [{ width: 20 }, { width: 16 }, { width: 12 }, { width: 12 }];

    (seasonData || []).forEach((s: any) => {
      const row = seasSheet.addRow([s.season, s.revenue, s.orders, s.units]);
      row.getCell(2).numFmt = currencyFmt;
      [3, 4].forEach(c => { row.getCell(c).numFmt = numberFmt; });
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Sales_Report_${year}.xlsx"`,
      },
    });

  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
