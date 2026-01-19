import jsPDF from 'jspdf';
import 'jspdf-autotable';

interface DashboardData {
  topPerformers: any[];
  falloutData: any[];
  profitabilityData: any[];
  cycleTimeData: any[];
  pullThroughData: any[];
  riskCases: any[];
}

export const generatePDF = (data: DashboardData) => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let yPos = margin;

  // Colors - typed as tuples for jsPDF compatibility
  const colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    accent: [number, number, number];
    warning: [number, number, number];
    text: [number, number, number];
    lightGray: [number, number, number];
  } = {
    primary: [30, 58, 138],
    secondary: [5, 150, 105],
    accent: [220, 38, 38],
    warning: [217, 119, 6],
    text: [31, 41, 55],
    lightGray: [243, 244, 246]
  };

  // Title Page
  doc.setFillColor(...colors.primary);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(36);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Reports', pageWidth / 2, pageHeight / 2 - 20, { align: 'center' });
  
  doc.setFontSize(24);
  doc.setFont('helvetica', 'normal');
  doc.text('Daily Intelligence Dashboard', pageWidth / 2, pageHeight / 2, { align: 'center' });
  
  doc.setFontSize(16);
  doc.text(new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }), pageWidth / 2, pageHeight / 2 + 15, { align: 'center' });
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'italic');
  doc.text('Powered by Ailethia', pageWidth / 2, pageHeight / 2 + 25, { align: 'center' });

  // Page 2: Top Performers
  doc.addPage();
  yPos = margin;
  
  doc.setTextColor(...colors.primary);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('TopTiering Performance', margin, yPos);
  yPos += 12;

  const top10 = data.topPerformers.slice(0, 10);
  const performersTableData = top10.map((p, idx) => [
    (idx + 1).toString(),
    p.name,
    p.role,
    p.score.toString(),
    p.loans.toString(),
    `$${(p.revenue / 1000).toFixed(0)}K`
  ]);

  (doc as any).autoTable({
    startY: yPos,
    head: [['Rank', 'Name', 'Role', 'Score', 'Loans', 'Revenue']],
    body: performersTableData,
    theme: 'striped',
    headStyles: {
      fillColor: colors.primary,
      textColor: [255, 255, 255],
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 10,
      cellPadding: 3
    },
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 50 },
      2: { cellWidth: 30 },
      3: { cellWidth: 20 },
      4: { cellWidth: 25 },
      5: { cellWidth: 30 }
    }
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;
  
  doc.setTextColor(...colors.text);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'italic');
  doc.text(
    `Key Insight: ${top10.length > 0 ? `${top10[0].name} leads with ${top10[0].score} performance score` : 'Top performers driving strong results'}`,
    margin,
    yPos
  );

  // Page 3: Fallout & Risk
  doc.addPage();
  yPos = margin;

  doc.setTextColor(...colors.warning);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Fallout & Risk Early-Warning', margin, yPos);
  yPos += 12;

  const falloutTableData = data.falloutData.map(d => [
    d.type,
    d.predicted.toString(),
    d.actual.toString(),
    d.risk.charAt(0).toUpperCase() + d.risk.slice(1)
  ]);

  (doc as any).autoTable({
    startY: yPos,
    head: [['Category', 'Predicted', 'Actual', 'Risk Level']],
    body: falloutTableData,
    theme: 'striped',
    headStyles: {
      fillColor: colors.warning,
      textColor: [255, 255, 255],
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 10,
      cellPadding: 3
    }
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  if (data.riskCases && data.riskCases.length > 0) {
    const highRiskCases = data.riskCases.filter((r: any) => r.risk === 'high').length;
    
    doc.setTextColor(...colors.accent);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`Critical Alerts: ${highRiskCases} high-risk cases require immediate attention`, margin, yPos);
    yPos += 10;

    doc.setTextColor(...colors.text);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    
    const topRisks = data.riskCases.slice(0, 3);
    topRisks.forEach((risk: any, idx: number) => {
      if (yPos > pageHeight - 30) {
        doc.addPage();
        yPos = margin;
      }
      doc.text(
        `${idx + 1}. ${risk.borrower} - ${risk.reason} (${risk.daysOverdue} days overdue)`,
        margin + 5,
        yPos
      );
      yPos += 7;
    });
  }

  // Page 4: Operations
  doc.addPage();
  yPos = margin;

  doc.setTextColor(...colors.primary);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Operations Speed & Capacity', margin, yPos);
  yPos += 12;

  const cycleTableData = data.cycleTimeData.map(d => [
    d.role,
    d.avgDays.toString(),
    d.targetDays.toString(),
    `${d.efficiency}%`
  ]);

  (doc as any).autoTable({
    startY: yPos,
    head: [['Role', 'Avg Days', 'Target Days', 'Efficiency %']],
    body: cycleTableData,
    theme: 'striped',
    headStyles: {
      fillColor: colors.primary,
      textColor: [255, 255, 255],
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 10,
      cellPadding: 3
    }
  });

  yPos = (doc as any).lastAutoTable.finalY + 15;

  doc.setTextColor(...colors.text);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Pull-Through Rate Funnel', margin, yPos);
  yPos += 10;

  const pullThroughTableData = data.pullThroughData.map(d => [
    d.stage,
    d.count.toString(),
    `${d.percentage}%`
  ]);

  (doc as any).autoTable({
    startY: yPos,
    head: [['Stage', 'Count', 'Percentage']],
    body: pullThroughTableData,
    theme: 'striped',
    headStyles: {
      fillColor: colors.secondary,
      textColor: [255, 255, 255],
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 10,
      cellPadding: 3
    }
  });

  // Page 5: Profitability
  doc.addPage();
  yPos = margin;

  doc.setTextColor(...colors.secondary);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Profitability Snapshot', margin, yPos);
  yPos += 12;

  const latestProfit = data.profitabilityData[data.profitabilityData.length - 1];
  if (latestProfit) {
    doc.setTextColor(...colors.text);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Current Month: ${latestProfit.month}`, margin, yPos);
    yPos += 12;

    const metricsTableData = [
      ['Net Margin', `${latestProfit.margin}%`],
      ['Productivity', `${latestProfit.productivity}%`],
      ['Revenue', `$${latestProfit.revenue}M`]
    ];

    (doc as any).autoTable({
      startY: yPos,
      head: [['Metric', 'Value']],
      body: metricsTableData,
      theme: 'striped',
      headStyles: {
        fillColor: colors.secondary,
        textColor: [255, 255, 255],
        fontStyle: 'bold'
      },
      styles: {
        fontSize: 12,
        cellPadding: 4
      },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 80 }
      }
    });

    yPos = (doc as any).lastAutoTable.finalY + 12;

    if (data.profitabilityData.length > 1) {
      const previousMonth = data.profitabilityData[data.profitabilityData.length - 2];
      const marginChange = latestProfit.margin - previousMonth.margin;
      const revenueChange = latestProfit.revenue - previousMonth.revenue;

      doc.setTextColor(...(marginChange >= 0 ? colors.secondary : colors.accent));
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `Trend: Margin ${marginChange >= 0 ? '+' : ''}${marginChange.toFixed(1)}%, Revenue ${revenueChange >= 0 ? '+' : ''}$${Math.abs(revenueChange).toFixed(1)}M`,
        margin,
        yPos
      );
    }
  }

  // Page 6: Executive Summary
  doc.addPage();
  doc.setFillColor(...colors.primary);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary', pageWidth / 2, margin + 20, { align: 'center' });

  yPos = margin + 40;
  const summaryPoints = [
    `Top Performers: ${top10.length} employees leading with exceptional results`,
    `Risk Management: ${data.riskCases?.length || 0} flagged cases requiring attention`,
    `Operations: Average cycle time ${data.cycleTimeData[0]?.avgDays || 'N/A'} days`,
    `Profitability: ${latestProfit ? `${latestProfit.margin}%` : 'N/A'} net margin this month`
  ];

  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  summaryPoints.forEach((point) => {
    doc.text(`• ${point}`, margin + 10, yPos);
    yPos += 10;
  });

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(
    'Next Steps: Review flagged cases and optimize operations',
    pageWidth / 2,
    pageHeight - 30,
    { align: 'center' }
  );

  // Add page numbers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 10,
      { align: 'right' }
    );
  }

  // Save the PDF
  const fileName = `Executive_Reports_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
  
  return fileName;
};
