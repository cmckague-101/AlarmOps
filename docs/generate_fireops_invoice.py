#!/usr/bin/env python3
"""Generate FireOps development invoice PDF."""

from decimal import Decimal
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUTPUT = Path(__file__).with_name("FireOps_Invoice_2026-001.pdf")
RATE = Decimal("50.00")

entries = [
    ("Aug 24, 2026", "Phase 1", 5, "Established hosting and Supabase backend; built fleet details, vehicle assignment, crew workflows, and initial UI."),
    ("Aug 25, 2026", "Phase 1", 2, "Implemented company login, password reset, crew accounts, self-assignment, issue management, uploads, and database updates."),
    ("Aug 26, 2026", "Phase 1", 2, "Added invitation and OTP sign-in flows; hardened user lifecycle, uploads, vehicle documents, and test readiness."),
    ("Aug 27, 2026", "Phase 2", 2, "Started Motive integration research and implementation, including fleet layout and camera controls."),
    ("Aug 28, 2026", "Phase 1 changes", 1, "Applied client-requested branding, theme, favicon, and login presentation changes."),
    ("Aug 28, 2026", "Phase 2", 3, "Continued integration-dependent work and prototyped operations mapping plus incident, vehicle, and crew assignments."),
    ("Aug 31, 2026", "Phase 3", 5, "Built communications, company documents, training, inventory, navigation, and desktop notification features."),
    ("Sep 2, 2026", "Phase 4", 2, "Reorganized project as shared web/mobile monorepo and extracted shared domain code; fixed deployment and invite acceptance."),
    ("Sep 3, 2026", "Phase 4", 1, "Started iOS app and added mobile issue creation/editing."),
    ("Sep 4, 2026", "Phase 4", 5, "Built mobile dashboard, communications, documents, operations map, crew, inventory, fleet, assignments, photos, and issue history."),
    ("Sep 6, 2026", "Phase 4", 3, "Added receipt workflow, owner editing, notifications, filters, theme fixes, icons, and session/logout fixes."),
    ("Sep 7, 2026", "Phase 4", 1, "Created public web landing page."),
    ("Sep 9, 2026", "Phase 4", 1, "Revised public landing page."),
    ("Sep 11, 2026", "Review", 2, "Redesigned dashboard from client review; updated header, greeting, quick actions, and NIFC statistics."),
    ("Sep 12, 2026", "Review", 3, "Applied broad review updates across maps, Motive, fleet, inspections, communications, roster, training, and qualifications."),
    ("Sep 14, 2026", "Review", 7, "Built qualification cards, approvals, signatures, annual/master records, and web support; completed mobile tests, performance, and session fixes."),
    ("Sep 15, 2026", "Android", 2, "Started Android app support and adapted map implementation."),
    ("Sep 16, 2026", "Android", 1, "Continued Android configuration, compatibility work, build checks, and device testing."),
    ("Sep 26, 2026", "Requested changes", 3, "Updated invoices, inspections, qualifications, owner profile, mobile login, App Store setup, and iOS map behavior."),
    ("Oct 6, 2026", "Requested changes", 5, "Implemented Motive OAuth, VIN sync, map markers, and camera work; added invoice generation, invitation resend, photos, and release fixes."),
    ("Oct 7, 2026", "Requested changes", 1, "Improved invitations and account re-add flow; fixed invoice styling and Motive diagnostics; prepared mobile production deployment."),
    ("Oct 9, 2026", "Consultation", 1, "Reviewed and discussed requested workflow and feature changes with client."),
    ("Oct 10, 2026", "Requested changes", 1, "Added company roles and permissions, vehicle note history/maps, notification rules, crew editing, and inspection fixes."),
    ("Oct 12, 2026", "Requested changes", 3, "Replaced payroll uploads with digital forms and refined payroll approval, summaries, crew selection, roster, chat, and qualifications."),
    ("Oct 13, 2026", "Requested changes", 1, "Fixed crew role constraints, removal authorization, and mobile crew removal completion."),
    ("Oct 14, 2026", "Requested changes", 3, "Refined payroll, qualifications, roster, notifications, attachments, PDFs, pagination, performance, security policies, and iOS release."),
    ("Oct 15, 2026", "Requested changes", 1, "Added read-only mobile offline mode and updated iOS release version."),
]

summary = [
    ("Phase 1 - Get site up and running", 9),
    ("Phase 1 - Client changes", 1),
    ("Phase 2 - Outside integrations", 5),
    ("Phase 3 - Additional features", 5),
    ("Phase 4 - Apps and business features", 13),
    ("Review and client feedback", 12),
    ("Android support", 3),
    ("Additional requested changes and consultation", 19),
]

assert sum(hours for _, _, hours, _ in entries) == 67
assert sum(hours for _, hours in summary) == 67

ORANGE = colors.HexColor("#E85D24")
DARK = colors.HexColor("#17212B")
MID = colors.HexColor("#52606D")
LIGHT = colors.HexColor("#F3F5F7")
BORDER = colors.HexColor("#D9DEE3")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="InvoiceTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=28, leading=32, textColor=DARK, alignment=TA_RIGHT, spaceAfter=4))
styles.add(ParagraphStyle(name="Accent", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=ORANGE, spaceAfter=5))
styles.add(ParagraphStyle(name="Meta", parent=styles["Normal"], fontName="Helvetica", fontSize=9, leading=13, textColor=MID))
styles.add(ParagraphStyle(name="BodySmall", parent=styles["Normal"], fontName="Helvetica", fontSize=8.4, leading=11.5, textColor=DARK))
styles.add(ParagraphStyle(name="BodyTiny", parent=styles["Normal"], fontName="Helvetica", fontSize=6.8, leading=8.2, textColor=DARK))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=DARK, spaceBefore=4, spaceAfter=8))
styles.add(ParagraphStyle(name="Amount", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=colors.white, alignment=TA_RIGHT))
styles.add(ParagraphStyle(name="AmountLabel", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.HexColor("#FFE8DE"), alignment=TA_RIGHT))


def money(value: Decimal) -> str:
    return f"${value:,.2f}"


def footer(canvas, doc):
    canvas.saveState()
    width, _ = letter
    canvas.setStrokeColor(BORDER)
    canvas.line(doc.leftMargin, 0.48 * inch, width - doc.rightMargin, 0.48 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MID)
    canvas.drawString(doc.leftMargin, 0.29 * inch, "FireOps development invoice • Reference: signed estimate dated August 25, 2026")
    canvas.drawRightString(width - doc.rightMargin, 0.29 * inch, f"Page {doc.page}")
    canvas.restoreState()


def cell(text, style="BodySmall"):
    return Paragraph(str(text), styles[style])


doc = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=letter,
    rightMargin=0.58 * inch,
    leftMargin=0.58 * inch,
    topMargin=0.52 * inch,
    bottomMargin=0.64 * inch,
    title="FireOps Invoice 2026-001",
    author="Ryan Inslee",
    subject="FireOps development services",
)

story = []
header = Table(
    [
        [Paragraph("FIREOPS", styles["Accent"]), Paragraph("INVOICE", styles["InvoiceTitle"])],
        [Paragraph("Development services", styles["Meta"]), Paragraph("#2026-001", styles["Meta"])],
    ],
    colWidths=[3.7 * inch, 3.1 * inch],
)
header.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
]))
story += [header, Spacer(1, 0.19 * inch)]

from_to = Table(
    [[
        Paragraph("<b>FROM</b><br/>Ryan Inslee<br/>ryan.inslee@icloud.com", styles["Meta"]),
        Paragraph("<b>BILL TO</b><br/>Fireco LLC<br/>Attn: Clint McKague", styles["Meta"]),
        Paragraph("<b>INVOICE DATE</b><br/>October 15, 2026<br/><br/><b>RATE</b><br/>$50.00 / hour", styles["Meta"]),
    ]],
    colWidths=[2.35 * inch, 2.35 * inch, 2.1 * inch],
)
from_to.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
    ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
    ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 9),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
]))
story += [from_to, Spacer(1, 0.22 * inch), Paragraph("Services summary", styles["Section"])]

summary_data = [[cell("DESCRIPTION"), cell("HOURS"), cell("RATE"), cell("AMOUNT")]]
for description, hours in summary:
    summary_data.append([
        cell(description),
        cell(f"{hours:g}"),
        cell(money(RATE)),
        cell(money(Decimal(str(hours)) * RATE)),
    ])
summary_table = Table(summary_data, colWidths=[4.53 * inch, 0.65 * inch, 0.78 * inch, 0.84 * inch], repeatRows=1)
summary_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), DARK),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
    ("LINEBELOW", (0, 1), (-1, -1), 0.4, BORDER),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ("TOPPADDING", (0, 0), (-1, -1), 5.5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
]))
story += [summary_table, Spacer(1, 0.16 * inch)]

total_hours = sum(hours for _, hours in summary)
total_due = Decimal(str(total_hours)) * RATE
total_box = Table(
    [[Paragraph(f"{total_hours:g} TOTAL HOURS", styles["AmountLabel"]), Paragraph("AMOUNT DUE", styles["AmountLabel"])],
     [Paragraph("", styles["Amount"]), Paragraph(money(total_due), styles["Amount"])]],
    colWidths=[3.9 * inch, 2.9 * inch],
)
total_box.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), ORANGE),
    ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
    ("SPAN", (0, 0), (0, 1)),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story += [total_box, Spacer(1, 0.14 * inch)]

notes = Paragraph(
    "<b>Basis:</b> Actual development time billed at $50/hour under signed FireOps Development Estimate & Quote approved August 25, 2026. "
    "Services include development, research, configuration, testing, troubleshooting, implementation, integration work, and requested changes. "
    "Third-party service charges are not included. Detailed work log follows.",
    styles["BodySmall"],
)
story += [KeepTogether([Paragraph("Invoice notes", styles["Section"]), notes]), PageBreak()]

story += [Paragraph("Detailed work log", styles["InvoiceTitle"]), Spacer(1, 0.08 * inch)]
detail_data = [[cell("DATE", "BodyTiny"), cell("CATEGORY", "BodyTiny"), cell("WORK SUMMARY", "BodyTiny"), cell("HRS", "BodyTiny"), cell("AMOUNT", "BodyTiny")]]
for date, category, hours, description in entries:
    detail_data.append([
        cell(date, "BodyTiny"),
        cell(category, "BodyTiny"),
        cell(description, "BodyTiny"),
        cell(f"{hours:g}", "BodyTiny"),
        cell(money(Decimal(str(hours)) * RATE), "BodyTiny"),
    ])
detail_data.append([cell("TOTAL", "BodyTiny"), "", "", cell(f"{total_hours:g}", "BodyTiny"), cell(money(total_due), "BodyTiny")])

detail_table = Table(detail_data, colWidths=[0.84 * inch, 0.92 * inch, 4.12 * inch, 0.35 * inch, 0.57 * inch], repeatRows=1)
detail_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), DARK),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, LIGHT]),
    ("LINEBELOW", (0, 1), (-1, -2), 0.35, BORDER),
    ("BACKGROUND", (0, -1), (-1, -1), ORANGE),
    ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
    ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ("SPAN", (0, -1), (2, -1)),
    ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ("TOPPADDING", (0, 0), (-1, -1), 2.8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.8),
]))
story.append(detail_table)

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f"Created {OUTPUT}")
