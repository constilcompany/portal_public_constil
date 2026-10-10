from typing import List, Union


# ==================== PROMPT BUILDERS ====================

DATA_VERIFICATION_RULES = """
═══════════════════════════════════════════════════════════════════════
DATA VERIFICATION & CONFIDENCE RULES
═══════════════════════════════════════════════════════════════════════
You must distinguish between:
• VERIFIED (directly visible on drawing)
• INFERRED (logically derived from dimensions)
• ASSUMED (based on industry standards)
For every major quantity:
- Mark whether it is VERIFIED or INFERRED.
- If data is not visible, state "NOT SHOWN ON DRAWING".
- Do NOT fabricate fixture counts.
- Do NOT estimate equipment not visually present.
- If scale must be used for estimation, clearly state it.
If insufficient information exists, reduce scope rather than guessing.
"""

GEOMETRY_VALIDATION = """
Before finalizing quantities:
- Cross-check total room areas against overall building footprint.
- Ensure corridor lengths align with grid spacing.
- Confirm that sum of room widths matches dimension chains.
- If mismatch >5%, re-evaluate calculations.
Perform internal validation before presenting final estimate.
"""

VISUAL_ANALYSIS_PROTOCOL = """
═══════════════════════════════════════════════════════════════════════
VISUAL ARCHITECTURAL PLAN INTERPRETATION PROTOCOL
═══════════════════════════════════════════════════════════════════════
This is a scaled architectural floor plan drawing.
You MUST analyze it visually like a professional estimator performing a manual quantity takeoff.
CRITICAL VISUAL RULES:
1. Treat walls as physical boundaries forming closed room shapes.
2. Use dimension strings to reconstruct room geometry.
3. Interpret gridlines (A–H, 1–22 etc.) as spatial references.
4. Understand door swings and wall breaks as openings.
5. Count symbols visually (do NOT assume typical counts unless missing).
6. Use scale (e.g., 3/32\" = 1'-0\") if dimensions are incomplete.
7. Identify corridor lengths from dimension chains.
8. Estimate areas when full dimensions are not shown using:
   - Adjacent dimensions
   - Overall building dimensions
   - Proportional scaling logic
9. If a room label exists without dimensions:
   - Infer size from similar room types nearby.
10. DO NOT rely only on extracted text.
    You must reason from visual layout relationships.
You are performing a real-world commercial quantity takeoff.
Think spatially.
Think geometrically.
Think like a field estimator.
"""

COST_DATABASE_SECTION = """═══════════════════════════════════════════════════════════════════════
COST DATABASE (Use these exact unit costs):
═══════════════════════════════════════════════════════════════════════
PAINTING & COATINGS:
- Wall Paint (2 coats): Material $0.45/SF | Labor $1.45/SF
- Ceiling Paint: Material $0.45/SF | Labor $1.45/SF
- Structural Skim Coat: Material $0.50/SF | Labor $1.45/SF
- Floor Paint (epoxy): Material $0.50/SF | Labor $1.45/SF

DOORS & FRAMES:
- 3'-0\" × 6'-8\" (Single): Material $47 | Labor $107
- 3'-5\" × 6'-8\": Material $54 | Labor $123
- 3'-0\" × 7'-0\": Material $49 | Labor $112
- 4'-0\" × 7'-0\" (Oversized): Material $65 | Labor $149
- 6'-0\" × 7'-0\" (Pair): Material $130 | Labor $298
- 8'-0\" × 7'-0\" (Pair): Material $173 | Labor $397

RAILINGS & SPECIALTIES:
- Handrail (wall-mounted): Material $0.50/LF | Labor $1.65/LF
- Guardrail (freestanding): Material $1.55/LF | Labor $4.10/LF
- Bollards (steel, painted): Material $8/EA | Labor $5/EA
- Dumpster Gate: Material $169/EA | Labor $384/EA

HVAC (DIVISION 23):
- Supply Air Diffuser (24\"×24\"): Material $85/EA | Labor $145/EA
- Return Air Grille (24\"×24\"): Material $65/EA | Labor $125/EA
- Thermostat (Programmable): Material $125/EA | Labor $95/EA
- Exhaust Fan (Bathroom): Material $185/EA | Labor $215/EA
- HVAC Ductwork (Allowance): Material $12/SF | Labor $18/SF (of floor area)
- Rooftop Unit (RTU) - 5 Ton: Material $3,200/EA | Labor $1,800/EA
- Split System AC Unit (Mini-Split): Material $2,400/EA | Labor $1,200/EA

PLUMBING (DIVISION 22):
- Water Closet (Commercial): Material $385/EA | Labor $425/EA
- Lavatory (Wall-Hung): Material $245/EA | Labor $325/EA
- Lavatory (Counter-Mounted): Material $195/EA | Labor $285/EA
- Kitchen Sink (Double Bowl): Material $425/EA | Labor $385/EA
- Shower Fixture (Complete): Material $685/EA | Labor $725/EA
- Bathtub (Standard): Material $825/EA | Labor $625/EA
- Water Heater (50 Gal): Material $1,200/EA | Labor $800/EA
- Floor Drain: Material $85/EA | Labor $165/EA
- Hose Bibb (Exterior): Material $45/EA | Labor $125/EA
- Water Supply Piping (Allowance): Material $8/SF | Labor $12/SF (of floor area)
- DWV Piping (Allowance): Material $10/SF | Labor $15/SF (of floor area)

ELECTRICAL (DIVISION 26):
- Duplex Outlet (120V): Material $8/EA | Labor $45/EA
- GFCI Outlet: Material $22/EA | Labor $55/EA
- Light Switch (Single-Pole): Material $5/EA | Labor $35/EA
- Light Switch (3-Way): Material $12/EA | Labor $45/EA
- LED Recessed Light (6\"): Material $35/EA | Labor $85/EA
- LED Surface Mount Fixture: Material $95/EA | Labor $125/EA
- Exit Sign (LED): Material $85/EA | Labor $95/EA
- Emergency Light: Material $165/EA | Labor $145/EA
- Electrical Panel (100A): Material $485/EA | Labor $625/EA
- Electrical Panel (200A): Material $925/EA | Labor $985/EA
- Smoke Detector (Hardwired): Material $65/EA | Labor $95/EA
- Carbon Monoxide Detector: Material $75/EA | Labor $95/EA
- Data Outlet (Cat6): Material $15/EA | Labor $65/EA
- Conduit & Wire (Allowance): Material $6/SF | Labor $10/SF (of floor area)

DRYWALL (DIVISION 09 — GYPSUM BOARD):
- Drywall 1/2\" Standard (walls): Material $0.38/SF | Labor $0.95/SF
- Drywall 5/8\" Type-X Fire-Rated (walls): Material $0.52/SF | Labor $1.05/SF
- Drywall 1/2\" Ceiling Board: Material $0.40/SF | Labor $1.10/SF
- Cement Board (wet areas): Material $0.85/SF | Labor $1.25/SF
- Taping & Finishing (Level 4): Material $0.22/SF | Labor $0.78/SF
- Taping & Finishing (Level 5 — smooth): Material $0.28/SF | Labor $1.05/SF
- Corner Bead (metal): Material $0.18/LF | Labor $0.35/LF
- Drywall Screws & Fasteners (Allowance): Material $0.05/SF | Labor $0.00/SF
- Shaft Wall Assembly (stairwell/elevator): Material $2.80/SF | Labor $3.50/SF

FLOORING (DIVISION 09 — FLOORING):
- Vinyl Plank (LVP) 5mm: Material $2.85/SF | Labor $1.65/SF
- Ceramic Tile (12\"×12\"): Material $3.50/SF | Labor $4.25/SF
- Porcelain Tile (24\"×24\"): Material $5.20/SF | Labor $5.50/SF
- Carpet (Commercial Grade): Material $2.40/SF | Labor $1.20/SF
- Carpet Pad (8lb): Material $0.55/SF | Labor $0.00/SF (included in carpet labor)
- Hardwood (3/4\" Solid Oak): Material $6.50/SF | Labor $4.00/SF
- Epoxy Floor Coating: Material $0.50/SF | Labor $1.45/SF
- Polished Concrete (2-step): Material $0.85/SF | Labor $2.50/SF
- Tile Substrate / Mortar Bed: Material $1.10/SF | Labor $1.80/SF
- Floor Tile Grout & Sealer: Material $0.30/SF | Labor $0.45/SF
- Transition Strips: Material $4.50/LF | Labor $2.50/LF
- Floor Leveling Compound (Allowance): Material $0.45/SF | Labor $0.55/SF

FRAMING (DIVISION 06 — ROUGH CARPENTRY / DIVISION 05 — METAL FRAMING):
- Metal Stud Framing 3-5/8\" 20ga (non-load-bearing): Material $1.05/SF | Labor $2.10/SF
- Metal Stud Framing 6\" 20ga (non-load-bearing): Material $1.25/SF | Labor $2.25/SF
- Metal Stud Framing 3-5/8\" 16ga (structural): Material $1.55/SF | Labor $2.60/SF
- Wood Stud Framing 2×4 (16\" o.c.): Material $1.20/SF | Labor $1.85/SF
- Wood Stud Framing 2×6 (16\" o.c.): Material $1.65/SF | Labor $2.00/SF
- LVL Beam (3-1/2\" × 9-1/2\"): Material $18.50/LF | Labor $12.00/LF
- LVL Beam (3-1/2\" × 11-7/8\"): Material $23.00/LF | Labor $14.00/LF
- Metal Track (floor/ceiling): Material $0.55/LF | Labor $0.65/LF
- Blocking & Fire Stopping: Material $0.45/SF | Labor $0.90/SF
- Structural Steel Column (W6×15): Material $28.00/LF | Labor $22.00/LF
- Structural Steel Beam (W8×31): Material $48.00/LF | Labor $35.00/LF
- Joist Hangers & Connectors (Allowance): Material $0.25/SF | Labor $0.15/SF

ROOFING (DIVISION 07 — THERMAL & MOISTURE PROTECTION):
- TPO Membrane 60mil (single-ply): Material $1.80/SF | Labor $2.20/SF
- EPDM Membrane 60mil: Material $1.65/SF | Labor $2.10/SF
- Modified Bitumen (2-ply): Material $2.10/SF | Labor $2.85/SF
- Built-Up Roofing (BUR 4-ply): Material $2.50/SF | Labor $3.20/SF
- Metal Standing Seam Roofing: Material $6.50/SF | Labor $5.25/SF
- Asphalt Shingles (30yr architectural): Material $1.95/SF | Labor $1.85/SF
- Roof Insulation — Polyiso 2\": Material $0.95/SF | Labor $0.55/SF
- Roof Insulation — Polyiso 4\": Material $1.75/SF | Labor $0.65/SF
- Roof Deck (5/8\" plywood): Material $0.85/SF | Labor $0.90/SF
- Roof Drain (Cast Iron): Material $285/EA | Labor $425/EA
- Overflow Drain: Material $185/EA | Labor $325/EA
- Roof Hatch (2'-6\" × 3'): Material $895/EA | Labor $625/EA
- Edge Metal / Coping: Material $4.50/LF | Labor $3.25/LF
- Flashing (sheet metal): Material $3.20/LF | Labor $4.50/LF
- Pipe Penetration Flashing: Material $45/EA | Labor $65/EA

INSULATION (DIVISION 07 — THERMAL & MOISTURE PROTECTION):
- Batt Insulation R-13 (3-1/2\" wall): Material $0.38/SF | Labor $0.45/SF
- Batt Insulation R-19 (6\" wall): Material $0.55/SF | Labor $0.50/SF
- Batt Insulation R-30 (ceiling/floor): Material $0.88/SF | Labor $0.60/SF
- Batt Insulation R-38 (attic): Material $1.10/SF | Labor $0.65/SF
- Rigid Board Insulation 1\" (XPS): Material $0.55/SF | Labor $0.45/SF
- Rigid Board Insulation 2\" (XPS): Material $1.05/SF | Labor $0.50/SF
- Rigid Board Insulation 2\" (Polyiso): Material $0.95/SF | Labor $0.50/SF
- Spray Foam — Open Cell (3-1/2\"): Material $1.10/SF | Labor $0.95/SF
- Spray Foam — Closed Cell (2\"): Material $2.40/SF | Labor $1.20/SF
- Pipe Insulation (1\" fiberglass, per LF): Material $1.25/LF | Labor $1.85/LF
- Sound Batt (interior partitions): Material $0.48/SF | Labor $0.48/SF
- Vapor Barrier (6mil poly): Material $0.12/SF | Labor $0.18/SF
- House Wrap / Air Barrier: Material $0.22/SF | Labor $0.35/SF

CLEANING (DIVISION 01 — GENERAL REQUIREMENTS / CLOSEOUT):
- Rough Clean (during construction): Material $0.05/SF | Labor $0.18/SF
- Final Clean (pre-turnover): Material $0.08/SF | Labor $0.42/SF
- Window Cleaning (interior & exterior): Material $0.05/SF | Labor $0.65/SF
- Pressure Washing (exterior): Material $0.05/SF | Labor $0.25/SF
- Construction Debris Removal (Allowance): Material $0.10/SF | Labor $0.22/SF
- Dumpster Rental (10yd, per pull): Material $425/EA | Labor $0/EA
- HEPA Vacuuming / Dust Control: Material $0.04/SF | Labor $0.20/SF
- Tile & Grout Cleaning (post-install): Material $0.06/SF | Labor $0.28/SF

FINISH CARPENTRY (DIVISION 06 — FINISH CARPENTRY & MILLWORK):
- Base Molding (painted MDF, 3-1/2\"): Material $1.20/LF | Labor $1.85/LF
- Base Molding (stain-grade wood, 3-1/2\"): Material $2.40/LF | Labor $2.10/LF
- Crown Molding (painted MDF, 3-1/2\"): Material $1.65/LF | Labor $2.50/LF
- Crown Molding (stain-grade wood, 3-1/2\"): Material $3.20/LF | Labor $2.85/LF
- Door Casing Set (painted MDF): Material $28/EA | Labor $45/EA
- Door Casing Set (stain-grade wood): Material $55/EA | Labor $55/EA
- Window Stool & Apron (painted MDF): Material $22/EA | Labor $38/EA
- Window Stool & Apron (stain-grade wood): Material $45/EA | Labor $45/EA
- Chair Rail (painted MDF, 2-1/2\"): Material $0.95/LF | Labor $1.65/LF
- Wainscoting Panel (MDF, per SF): Material $3.50/SF | Labor $4.25/SF
- Closet Shelving System (wire, per LF): Material $8.50/LF | Labor $6.50/LF
- Closet Shelving System (wood, per LF): Material $14.00/LF | Labor $8.50/LF
- Built-In Cabinetry (base, per LF): Material $185/LF | Labor $95/LF
- Built-In Cabinetry (upper, per LF): Material $145/LF | Labor $85/LF
- Countertop — Laminate (per LF): Material $38/LF | Labor $22/LF
- Countertop — Quartz/Solid Surface (per LF): Material $120/LF | Labor $45/LF
- Stair Treads (oak, per EA): Material $65/EA | Labor $55/EA
- Stair Risers (MDF painted, per EA): Material $18/EA | Labor $35/EA
- Handrail (wood, wall-mounted, per LF): Material $14/LF | Labor $18/LF
- Miscellaneous Blocking & Nailers (Allowance): Material $0.15/SF | Labor $0.25/SF

WINDOWS INSTALLATION (DIVISION 08 — OPENINGS):
- Single-Hung Window (2'-0\"×3'-0\", vinyl): Material $185/EA | Labor $145/EA
- Single-Hung Window (2'-6\"×4'-0\", vinyl): Material $225/EA | Labor $165/EA
- Double-Hung Window (3'-0\"×5'-0\", vinyl): Material $310/EA | Labor $185/EA
- Double-Hung Window (3'-0\"×5'-0\", wood): Material $485/EA | Labor $215/EA
- Casement Window (2'-0\"×4'-0\", vinyl): Material $265/EA | Labor $175/EA
- Casement Window (2'-0\"×4'-0\", aluminum): Material $345/EA | Labor $195/EA
- Fixed Picture Window (4'-0\"×5'-0\", vinyl): Material $355/EA | Labor $195/EA
- Sliding Window (4'-0\"×3'-0\", vinyl): Material $295/EA | Labor $175/EA
- Awning Window (2'-6\"×2'-0\", vinyl): Material $215/EA | Labor $155/EA
- Bay Window (4'-0\"×5'-0\", vinyl): Material $895/EA | Labor $385/EA
- Egress Window (min. code size, vinyl): Material $375/EA | Labor $225/EA
- Storefront Window System (per SF): Material $38/SF | Labor $28/SF
- Window Flashing & Sealant (per EA): Material $18/EA | Labor $35/EA
- Window Screen (replacement, per EA): Material $45/EA | Labor $25/EA
- Window Trim & Casing (interior, per EA): Material $28/EA | Labor $38/EA
- Window Well (egress, steel): Material $185/EA | Labor $125/EA

DOORS INSTALLATION (DIVISION 08 — OPENINGS):
- Interior Door 3'-0\"×6'-8\" (hollow core): Material $85/EA | Labor $107/EA
- Interior Door 3'-0\"×6'-8\" (solid core): Material $145/EA | Labor $120/EA
- Interior Door 3'-0\"×8'-0\" (solid core): Material $185/EA | Labor $135/EA
- Interior Door 2'-6\"×6'-8\" (hollow core): Material $75/EA | Labor $100/EA
- Bifold Door (3'-0\"×6'-8\", pair): Material $95/EA | Labor $85/EA
- Sliding Barn Door (4'-0\"×8'-0\"): Material $285/EA | Labor $195/EA
- Pocket Door (3'-0\"×6'-8\"): Material $165/EA | Labor $225/EA
- Exterior Door 3'-0\"×6'-8\" (fiberglass): Material $325/EA | Labor $195/EA
- Exterior Door 3'-0\"×6'-8\" (steel insulated): Material $245/EA | Labor $185/EA
- Exterior Door 3'-0\"×8'-0\" (fiberglass): Material $385/EA | Labor $215/EA
- French Door Pair 5'-0\"×6'-8\" (exterior): Material $685/EA | Labor $285/EA
- Patio Sliding Door 6'-0\"×6'-8\" (vinyl): Material $595/EA | Labor $265/EA
- Patio Sliding Door 8'-0\"×6'-8\" (aluminum): Material $895/EA | Labor $295/EA
- Fire-Rated Door 3'-0\"×7'-0\" (20-min, HM): Material $465/EA | Labor $225/EA
- Fire-Rated Door 3'-0\"×7'-0\" (90-min, HM): Material $685/EA | Labor $265/EA
- Garage Door (16'-0\"×7'-0\", steel): Material $985/EA | Labor $425/EA
- Door Hardware Set (lockset + hinges, per door): Material $85/EA | Labor $45/EA
- Door Hardware Set (commercial grade, per door): Material $185/EA | Labor $65/EA
- Door Closer (commercial): Material $95/EA | Labor $75/EA
- Door Frame (steel, knocked down): Material $95/EA | Labor $85/EA
- Door Frame (wood, pre-hung): Material $55/EA | Labor $45/EA
- Weatherstripping (per door): Material $22/EA | Labor $28/EA

SIDING INSTALLATION (DIVISION 07 — THERMAL & MOISTURE PROTECTION / EXTERIOR):
- Vinyl Siding (lap, .044\" profile): Material $1.45/SF | Labor $1.85/SF
- Vinyl Siding (Dutch lap, premium): Material $1.85/SF | Labor $1.95/SF
- Fiber Cement Siding (lap, HardiePlank): Material $2.85/SF | Labor $2.65/SF
- Fiber Cement Siding (panel, HardiePanel): Material $2.65/SF | Labor $2.45/SF
- LP SmartSide (lap, engineered wood): Material $2.45/SF | Labor $2.25/SF
- Cedar Bevel Siding (1\"×6\", clear): Material $4.85/SF | Labor $3.25/SF
- Cedar Shake Siding (hand-split): Material $5.50/SF | Labor $4.25/SF
- Engineered Wood Siding (T1-11 panel): Material $1.95/SF | Labor $1.75/SF
- Stucco (3-coat system): Material $2.80/SF | Labor $4.50/SF
- EIFS / Dryvit System: Material $3.50/SF | Labor $4.85/SF
- Brick Veneer (modular): Material $9.50/SF | Labor $12.50/SF
- Stone Veneer (manufactured, thin): Material $8.50/SF | Labor $10.50/SF
- Metal Panel Siding (ACM, 4mm): Material $12.50/SF | Labor $9.50/SF
- Board & Batten (fiber cement): Material $3.25/SF | Labor $2.85/SF
- House Wrap / Weather Barrier (under siding): Material $0.22/SF | Labor $0.35/SF
- Starter Strip / J-Channel (vinyl): Material $0.45/LF | Labor $0.65/LF
- Corner Trim (vinyl or fiber cement): Material $1.85/LF | Labor $1.45/LF
- Soffit (vinyl, vented): Material $1.65/SF | Labor $1.85/SF
- Fascia Board (PVC, 5/4\"×6\"): Material $2.85/LF | Labor $2.25/LF
- Siding Caulking & Sealant (Allowance): Material $0.12/SF | Labor $0.18/SF
"""

ANALYSIS_METHODOLOGY = """═══════════════════════════════════════════════════════════════════════
ANALYSIS METHODOLOGY
═══════════════════════════════════════════════════════════════════════
STEP 1: PDF COMPREHENSION
- Identify the project type (hotel, office, residential, etc.)
- Locate and extract the project title, address, and sheet information
- Find the drawing scale (e.g., "1/8\" = 1'-0\"" or "3/32\" = 1'-0\"")
- Identify all floor levels shown (basement, 1st floor, 2nd floor, roof, etc.)
- Note any legends, symbols, or annotation keys

STEP 2: DIMENSION EXTRACTION
- Extract ALL dimension strings visible in the PDF
- Convert imperial measurements to decimal feet:
  - "13'-6\"" → 13.5 feet
  - "24'-10 1/2\"" → 24.875 feet
  - "8'-2 3/4\"" → 8.229 feet
- Identify dimension chains (sequential dimensions along walls)
- Note overall building dimensions

STEP 3: ROOM IDENTIFICATION
- Identify all room labels and numbers
- Classify each room by type
- Count total rooms of each type
- Note room dimensions where visible

STEP 4: ARCHITECTURAL ELEMENTS
- Count all doors by type and size
- Identify window locations
- Locate stairways and count runs/landings
- Find railings/guardrails
- Note any special features

STEP 5: MEP ELEMENT IDENTIFICATION
- Count plumbing fixtures (toilets, sinks, showers, etc.)
- Identify HVAC symbols (supply/return diffusers, thermostats, equipment)
- Count electrical outlets, switches, lighting fixtures
- Note panel locations and electrical rooms
- Identify mechanical rooms and chase locations

STEP 6: AREA CALCULATIONS
For each room/space:
- Floor area = length × width
- Wall area = perimeter × ceiling height
- Ceiling area = floor area
- Apply appropriate deductions

STEP 7: MATERIAL QUANTITIES
- Aggregate all wall areas by finish type
- Aggregate all ceiling areas by finish type
- Count doors by size category
- Measure handrail/guardrail linear footage
- Count all MEP fixtures and devices by type

STEP 8: ASSEMBLY QUANTITIES (NEW DIVISIONS)
- Drywall: Calculate wall face area (both sides of framed partitions) + ceiling area
- Flooring: Calculate net floor area per room; classify finish type per room label
- Framing: Identify partition wall linear footage × height for stud area; note beam/column locations
- Roofing: Use overall building footprint + overhang/parapet allowances for roof area
- Insulation: Identify exterior wall area, roof area, and interior sound-partition area separately
- Cleaning: Use gross floor area (GFA) of all occupied levels for allowance-based quantities
- Finish Carpentry: Measure base/crown molding LF (room perimeters minus openings); count door casings, window stools, stair treads/risers; estimate built-in cabinetry LF from room labels
- Windows Installation: Count all window symbols on drawings by type and size; measure storefront systems by SF; note egress windows separately per code
- Doors Installation: Count all door symbols on drawings by leaf size, type (interior/exterior/fire-rated); identify hardware requirements; note frame type per door category
- Siding Installation: Calculate gross exterior wall area (perimeter × floor-to-floor height × floors minus window/door openings); identify siding type from exterior elevations or notes; measure corner trim LF, soffit SF, and fascia LF separately
"""

def build_output_format_section(scopes: Union[str, List[str]]) -> str:
    """Return the markdown output format tailored to the requested scopes.
    
    Args:
        scopes: A single scope string or a list of scope strings.
                Possible values: "Overall", "Finishes", "Drywall", "Flooring",
                "Framing", "Roofing", "Insulation", "Cleaning", "Plumbing",
                "HVAC", "Electrical".
    
    Returns:
        Markdown string with the required sections.
    """
    # Normalize input to a list
    if isinstance(scopes, str):
        scopes = [scopes]
    
    # Determine which sections to include
    include_overall = "Overall" in scopes
    include_finishes = include_overall or "Finishes" in scopes
    include_drywall = include_overall or "Drywall" in scopes
    include_flooring = include_overall or "Flooring" in scopes
    include_framing = include_overall or "Framing" in scopes
    include_roofing = include_overall or "Roofing" in scopes
    include_insulation = include_overall or "Insulation" in scopes
    include_cleaning = include_overall or "Cleaning" in scopes
    include_plumbing = include_overall or "Plumbing" in scopes
    include_hvac = include_overall or "HVAC" in scopes
    include_electrical = include_overall or "Electrical" in scopes
    include_finish_carpentry = include_overall or "FinishCarpentry" in scopes
    include_windows = include_overall or "Windows" in scopes
    include_doors = include_overall or "Doors" in scopes
    include_siding = include_overall or "Siding" in scopes
    
    # Build a description for the header
    if include_overall:
        scope_desc = "Full Estimate — All Divisions (01, 05/06, 07, 09, 22, 23, 26)"
    else:
        # Create a comma-separated list of the selected scopes
        scope_names = {
            "Finishes": "Division 09 — Finishes (Painting)",
            "Drywall": "Division 09 — Drywall",
            "Flooring": "Division 09 — Flooring",
            "Framing": "Division 05/06 — Framing",
            "Roofing": "Division 07 — Roofing",
            "Insulation": "Division 07 — Insulation",
            "Cleaning": "Division 01 — Cleaning",
            "Plumbing": "Division 22 — Plumbing",
            "HVAC": "Division 23 — HVAC",
            "Electrical": "Division 26 — Electrical",
            "FinishCarpentry": "Division 06 — Finish Carpentry",
            "Windows": "Division 08 — Windows Installation",
            "Doors": "Division 08 — Doors Installation",
            "Siding": "Division 07 — Siding Installation",
        }
        selected = [scope_names[s] for s in scopes if s in scope_names]
        scope_desc = "Selected Scopes: " + ", ".join(selected) if selected else "Custom Scope"
    
    # ── Header ───────────────────────────────────────────────────────────────
    header = """
═══════════════════════════════════════════════════════════════════════
REQUIRED OUTPUT FORMAT (MARKDOWN)
═══════════════════════════════════════════════════════════════════════
Generate output in this EXACT markdown structure:

# ESTIMATE OF MATERIALS AND COST OF CONSTRUCTION
**Date:** {current_date}  
**Project ID:** {extracted_project_name}  
**Address:** {extracted_address}  
**Scope:** {scope_description}  
**Drawing Reference:** {sheet_number}  
**Scale:** {drawing_scale}

---
"""

    # ── Division sections (defined as in original code) ──────────────────────
    div01 = ""
    if include_overall:   # General Requirements only for Overall
        div01 = """
## DIVISION 01 — GENERAL REQUIREMENTS
| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| 1.01 | 01 21 00 | Permits & Fees | LS | 1 | 0% | 1 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | General |
| 1.02 | 01 31 00 | Project Management | LS | 1 | 0% | 1 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | General |
| 1.03 | 01 50 00 | Temporary Facilities | LS | 1 | 0% | 1 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | General |
| 1.04 | 01 74 00 | Cleaning & Waste Mgmt | LS | 1 | 0% | 1 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | General |

**Division 01 Subtotal:** $0.00

---
"""

    div09_finishes = ""
    if include_finishes:
        div09_finishes = """
## DIVISION 09 — FINISHES (PAINTING)
### FIRST FLOOR
**CALCULATION SUMMARY:**
- Total Rooms: {count}
- Guest Rooms: {count} ({list room numbers})
- Corridors: {linear feet}
- Public Spaces: {list spaces}

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| 2.01 | 09 91 23 | Wall Paint - Interior (2 Coats) | SF | {wall_area} | 5% | {with_waste} | $0.45 | ${amount} | $1.45 | ${amount} | ${total} | Painting |
| 2.02 | 09 91 23 | Ceiling Paint | SF | {ceiling_area} | 5% | {with_waste} | $0.45 | ${amount} | $1.45 | ${amount} | ${total} | Painting |
| 2.03 | 09 91 23 | Interior Door & Frame Painting | SF | {door_paint_area} | 5% | {with_waste} | $0.45 | ${amount} | $1.45 | ${amount} | ${total} | Painting |
| 2.04 | 09 91 23 | Window Frame Painting | SF | {window_paint_area} | 5% | {with_waste} | $0.45 | ${amount} | $1.45 | ${amount} | ${total} | Painting |

---
**Show Your Work for Key Calculations:**

Door Paint Calculation:
Standard 3'-0" × 7'-0" door  
Area per side = 3 × 7 = 21 SF  
Both sides = 42 SF  
Add 15% for frame = 48.3 SF per door  
Total Door Paint Area = 48.3 × {door_count}

Window Frame Paint Calculation:
Approximate perimeter-based estimate per window:
(Width + Height) × 2 × 0.5 SF conversion factor  
Total Window Paint Area = Sum of all window frame areas

Example Room Calculation:
Guest Room 101:
12'-6" × 14'-2" = 177.08 SF floor  
Perimeter = (12.5 + 14.17) × 2 = 53.34 LF  
Wall area = 53.34 LF × 9' height × 0.85 deduction factor = 408 SF  

---
**Division 09 — Finishes (Painting) Subtotal:** ${amount}

---
"""

    div09_drywall = ""
    if include_drywall:
        div09_drywall = """
## DIVISION 09 — DRYWALL (GYPSUM BOARD ASSEMBLIES)
**CALCULATION SUMMARY:**
- Total Wall Face Area (both sides): {wall_face_area} SF
- Total Ceiling Drywall Area: {ceiling_area} SF
- Wet / Fire-Rated Areas: {special_area} SF
- Total Corner Bead (LF): {corner_bead_lf} LF

**AREA METHODOLOGY:**
- Wall face area = partition LF × ceiling height × 2 sides (minus door/window openings)
- Ceiling area = net floor area of all rooms
- Cement board applied to all bathroom/wet-area wall and floor substrates

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| D.01 | 09 21 16 | Drywall 1/2\" Standard — Walls | SF | {wall_std_area} | 10% | {with_waste} | $0.38 | ${amount} | $0.95 | ${amount} | ${total} | Drywall |
| D.02 | 09 21 16 | Drywall 5/8\" Type-X Fire-Rated — Walls | SF | {wall_fx_area} | 10% | {with_waste} | $0.52 | ${amount} | $1.05 | ${amount} | ${total} | Drywall |
| D.03 | 09 21 16 | Drywall 1/2\" — Ceiling | SF | {ceiling_area} | 10% | {with_waste} | $0.40 | ${amount} | $1.10 | ${amount} | ${total} | Drywall |
| D.04 | 09 21 16 | Cement Board (wet areas) | SF | {cement_bd_area} | 10% | {with_waste} | $0.85 | ${amount} | $1.25 | ${amount} | ${total} | Drywall |
| D.05 | 09 29 00 | Taping & Finishing — Level 4 | SF | {tape_area} | 5% | {with_waste} | $0.22 | ${amount} | $0.78 | ${amount} | ${total} | Drywall |
| D.06 | 09 29 00 | Taping & Finishing — Level 5 (Smooth) | SF | {level5_area} | 5% | {with_waste} | $0.28 | ${amount} | $1.05 | ${amount} | ${total} | Drywall |
| D.07 | 09 21 16 | Corner Bead (Metal) | LF | {corner_bead_lf} | 5% | {with_waste} | $0.18 | ${amount} | $0.35 | ${amount} | ${total} | Drywall |
| D.08 | 09 21 16 | Fasteners & Screws (Allowance) | SF | {total_dw_area} | 5% | {with_waste} | $0.05 | ${amount} | $0.00 | $0.00 | ${total} | Drywall |
| D.09 | 09 21 29 | Shaft Wall Assembly (stair/elevator) | SF | {shaft_area} | 10% | {with_waste} | $2.80 | ${amount} | $3.50 | ${amount} | ${total} | Drywall |

---
**Show Your Work:**
Wall Face Area = Partition Length (LF) × Ceiling Height × 2 sides − Openings  
Example: 200 LF × 9' × 2 = 3,600 SF − 15% openings = 3,060 SF

**Division 09 — Drywall Subtotal:** ${amount}

---
"""

    div09_flooring = ""
    if include_flooring:
        div09_flooring = """
## DIVISION 09 — FLOORING
**CALCULATION SUMMARY:**
- Total Net Floor Area: {total_floor_area} SF
- LVP / Vinyl Areas: {lvp_area} SF
- Tile Areas (ceramic/porcelain): {tile_area} SF
- Carpet Areas: {carpet_area} SF
- Other Floor Finishes: {other_area} SF

**AREA METHODOLOGY:**
- Net floor area per room (room dimensions minus wall thickness deductions)
- Finish type assigned per room label per architectural finish schedule
- Transition strips measured at all finish change boundaries

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| FL.01 | 09 65 19 | Vinyl Plank (LVP) 5mm | SF | {lvp_area} | 10% | {with_waste} | $2.85 | ${amount} | $1.65 | ${amount} | ${total} | Flooring |
| FL.02 | 09 30 13 | Ceramic Tile 12\"×12\" | SF | {ceramic_area} | 10% | {with_waste} | $3.50 | ${amount} | $4.25 | ${amount} | ${total} | Flooring |
| FL.03 | 09 30 13 | Porcelain Tile 24\"×24\" | SF | {porcelain_area} | 10% | {with_waste} | $5.20 | ${amount} | $5.50 | ${amount} | ${total} | Flooring |
| FL.04 | 09 68 13 | Carpet (Commercial Grade) | SF | {carpet_area} | 10% | {with_waste} | $2.40 | ${amount} | $1.20 | ${amount} | ${total} | Flooring |
| FL.05 | 09 68 13 | Carpet Pad (8lb) | SF | {carpet_area} | 10% | {with_waste} | $0.55 | ${amount} | $0.00 | $0.00 | ${total} | Flooring |
| FL.06 | 09 96 23 | Epoxy Floor Coating | SF | {epoxy_area} | 10% | {with_waste} | $0.50 | ${amount} | $1.45 | ${amount} | ${total} | Flooring |
| FL.07 | 09 30 13 | Tile Substrate / Mortar Bed | SF | {tile_substrate_area} | 10% | {with_waste} | $1.10 | ${amount} | $1.80 | ${amount} | ${total} | Flooring |
| FL.08 | 09 30 13 | Grout & Sealer | SF | {tile_grout_area} | 5% | {with_waste} | $0.30 | ${amount} | $0.45 | ${amount} | ${total} | Flooring |
| FL.09 | 09 65 19 | Transition Strips | LF | {transition_lf} | 5% | {with_waste} | $4.50 | ${amount} | $2.50 | ${amount} | ${total} | Flooring |
| FL.10 | 03 54 13 | Floor Leveling Compound (Allowance) | SF | {total_floor_area} | 5% | {with_waste} | $0.45 | ${amount} | $0.55 | ${amount} | ${total} | Flooring |

---
**Show Your Work:**
Room Floor Area Example: Room 101 = 12.5' × 14.17' = 177.1 SF (LVP)  
Tile Area: All bathrooms + wet areas totaled = {tile_area} SF  
Carpet: All guest rooms / bedrooms totaled = {carpet_area} SF

**Division 09 — Flooring Subtotal:** ${amount}

---
"""

    div06_framing = ""
    if include_framing:
        div06_framing = """
## DIVISION 06 / 05 — FRAMING (ROUGH CARPENTRY & METAL STUDS)
**CALCULATION SUMMARY:**
- Total Partition Wall Area (stud face): {partition_area} SF
- Exterior Wall Framing Area: {ext_wall_area} SF
- Beam Linear Footage: {beam_lf} LF
- Column Count / Linear Footage: {col_count} EA / {col_lf} LF
- Blocking & Miscellaneous Framing: {block_area} SF

**FRAMING METHODOLOGY:**
- Stud face area = partition LF × ceiling height (one face, full height)
- Metal studs: non-load-bearing interior partitions
- Wood framing: load-bearing walls and exterior walls where applicable
- Beams sized per structural notes on drawing; assumed if not shown

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| FR.01 | 09 22 16 | Metal Stud 3-5/8\" 20ga (non-LB) | SF | {metal_stud_area} | 10% | {with_waste} | $1.05 | ${amount} | $2.10 | ${amount} | ${total} | Framing |
| FR.02 | 09 22 16 | Metal Stud 6\" 20ga (non-LB) | SF | {metal_stud_6_area} | 10% | {with_waste} | $1.25 | ${amount} | $2.25 | ${amount} | ${total} | Framing |
| FR.03 | 09 22 16 | Metal Stud 3-5/8\" 16ga (structural) | SF | {metal_stud_16ga_area} | 10% | {with_waste} | $1.55 | ${amount} | $2.60 | ${amount} | ${total} | Framing |
| FR.04 | 06 11 00 | Wood Stud 2×4 (16\" o.c.) | SF | {wood_2x4_area} | 10% | {with_waste} | $1.20 | ${amount} | $1.85 | ${amount} | ${total} | Framing |
| FR.05 | 06 11 00 | Wood Stud 2×6 (16\" o.c.) | SF | {wood_2x6_area} | 10% | {with_waste} | $1.65 | ${amount} | $2.00 | ${amount} | ${total} | Framing |
| FR.06 | 06 11 23 | LVL Beam 3-1/2\" × 9-1/2\" | LF | {lvl_95_lf} | 5% | {with_waste} | $18.50 | ${amount} | $12.00 | ${amount} | ${total} | Framing |
| FR.07 | 06 11 23 | LVL Beam 3-1/2\" × 11-7/8\" | LF | {lvl_118_lf} | 5% | {with_waste} | $23.00 | ${amount} | $14.00 | ${amount} | ${total} | Framing |
| FR.08 | 09 22 16 | Metal Track (floor & ceiling) | LF | {track_lf} | 5% | {with_waste} | $0.55 | ${amount} | $0.65 | ${amount} | ${total} | Framing |
| FR.09 | 06 11 00 | Blocking & Fire Stopping | SF | {blocking_area} | 10% | {with_waste} | $0.45 | ${amount} | $0.90 | ${amount} | ${total} | Framing |
| FR.10 | 05 12 00 | Structural Steel Column (W6×15) | LF | {col_lf} | 5% | {with_waste} | $28.00 | ${amount} | $22.00 | ${amount} | ${total} | Framing |
| FR.11 | 05 12 00 | Structural Steel Beam (W8×31) | LF | {beam_lf} | 5% | {with_waste} | $48.00 | ${amount} | $35.00 | ${amount} | ${total} | Framing |
| FR.12 | 06 05 23 | Joist Hangers & Connectors (Allowance) | SF | {total_floor_area} | 5% | {with_waste} | $0.25 | ${amount} | $0.15 | ${amount} | ${total} | Framing |

---
**Show Your Work:**
Metal Stud Area Example: 200 LF of partitions × 9' height = 1,800 SF (stud face)  
Track LF = partition LF × 2 (floor + ceiling) = {track_lf} LF

**Division 06/05 — Framing Subtotal:** ${amount}

---
"""

    div07_roofing = ""
    if include_roofing:
        div07_roofing = """
## DIVISION 07 — ROOFING
**CALCULATION SUMMARY:**
- Gross Roof Area: {roof_area} SF
- Membrane Type: {membrane_type}
- Roof Drains: {drain_count} EA
- Edge Metal / Coping: {edge_lf} LF
- Pipe Penetrations: {penetration_count} EA

**AREA METHODOLOGY:**
- Roof area = building footprint + overhang/parapet allowance (typically +5–10%)
- Membrane area includes 6\" overlaps at seams (covered by wastage factor)
- Insulation area = roof area (applied below membrane)
- Edge metal measured around full roof perimeter

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| RF.01 | 07 54 19 | TPO Membrane 60mil | SF | {tpo_area} | 10% | {with_waste} | $1.80 | ${amount} | $2.20 | ${amount} | ${total} | Roofing |
| RF.02 | 07 53 23 | EPDM Membrane 60mil | SF | {epdm_area} | 10% | {with_waste} | $1.65 | ${amount} | $2.10 | ${amount} | ${total} | Roofing |
| RF.03 | 07 52 16 | Modified Bitumen (2-ply) | SF | {modbit_area} | 10% | {with_waste} | $2.10 | ${amount} | $2.85 | ${amount} | ${total} | Roofing |
| RF.04 | 07 41 13 | Metal Standing Seam | SF | {metal_roof_area} | 10% | {with_waste} | $6.50 | ${amount} | $5.25 | ${amount} | ${total} | Roofing |
| RF.05 | 07 31 13 | Asphalt Shingles (30yr Architectural) | SF | {shingle_area} | 10% | {with_waste} | $1.95 | ${amount} | $1.85 | ${amount} | ${total} | Roofing |
| RF.06 | 07 22 00 | Roof Insulation — Polyiso 2\" | SF | {polyiso_2_area} | 5% | {with_waste} | $0.95 | ${amount} | $0.55 | ${amount} | ${total} | Roofing |
| RF.07 | 07 22 00 | Roof Insulation — Polyiso 4\" | SF | {polyiso_4_area} | 5% | {with_waste} | $1.75 | ${amount} | $0.65 | ${amount} | ${total} | Roofing |
| RF.08 | 06 16 23 | Roof Deck — 5/8\" Plywood | SF | {deck_area} | 5% | {with_waste} | $0.85 | ${amount} | $0.90 | ${amount} | ${total} | Roofing |
| RF.09 | 22 14 23 | Roof Drain (Cast Iron) | EA | {drain_count} | 0% | {with_waste} | $285.00 | ${amount} | $425.00 | ${amount} | ${total} | Roofing |
| RF.10 | 22 14 23 | Overflow Drain | EA | {overflow_count} | 0% | {with_waste} | $185.00 | ${amount} | $325.00 | ${amount} | ${total} | Roofing |
| RF.11 | 07 71 19 | Roof Hatch (2'-6\" × 3') | EA | {hatch_count} | 0% | {with_waste} | $895.00 | ${amount} | $625.00 | ${amount} | ${total} | Roofing |
| RF.12 | 07 71 00 | Edge Metal / Coping | LF | {edge_lf} | 5% | {with_waste} | $4.50 | ${amount} | $3.25 | ${amount} | ${total} | Roofing |
| RF.13 | 07 62 00 | Sheet Metal Flashing | LF | {flash_lf} | 5% | {with_waste} | $3.20 | ${amount} | $4.50 | ${amount} | ${total} | Roofing |
| RF.14 | 07 62 00 | Pipe Penetration Flashing | EA | {penetration_count} | 0% | {with_waste} | $45.00 | ${amount} | $65.00 | ${amount} | ${total} | Roofing |

---
**Show Your Work:**
Roof Area = Building Footprint × 1.05 (5% overhang/parapet allowance)  
Edge Metal = Building Perimeter LF  
Drains: 1 per 10,000 SF of roof area (min 2 per code)

**Division 07 — Roofing Subtotal:** ${amount}

---
"""

    div07_insulation = ""
    if include_insulation:
        div07_insulation = """
## DIVISION 07 — INSULATION
**CALCULATION SUMMARY:**
- Exterior Wall Area: {ext_wall_area} SF
- Roof / Ceiling Insulation Area: {roof_ins_area} SF
- Interior Sound Partition Area: {sound_partition_area} SF
- Pipe Insulation: {pipe_ins_lf} LF

**AREA METHODOLOGY:**
- Exterior wall area = building perimeter × floor-to-floor height × number of floors − exterior openings
- Roof insulation area = gross roof area (matches roofing scope)
- Sound batts: applied to all corridor/unit-separation walls
- Vapor barrier: applied to exterior walls in all climate-controlled areas

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| IN.01 | 07 21 13 | Batt Insulation R-13 (3-1/2\" wall) | SF | {r13_area} | 10% | {with_waste} | $0.38 | ${amount} | $0.45 | ${amount} | ${total} | Insulation |
| IN.02 | 07 21 13 | Batt Insulation R-19 (6\" wall) | SF | {r19_area} | 10% | {with_waste} | $0.55 | ${amount} | $0.50 | ${amount} | ${total} | Insulation |
| IN.03 | 07 21 13 | Batt Insulation R-30 (ceiling/floor) | SF | {r30_area} | 10% | {with_waste} | $0.88 | ${amount} | $0.60 | ${amount} | ${total} | Insulation |
| IN.04 | 07 21 13 | Batt Insulation R-38 (attic) | SF | {r38_area} | 10% | {with_waste} | $1.10 | ${amount} | $0.65 | ${amount} | ${total} | Insulation |
| IN.05 | 07 21 29 | Rigid Board XPS 1\" | SF | {xps_1_area} | 5% | {with_waste} | $0.55 | ${amount} | $0.45 | ${amount} | ${total} | Insulation |
| IN.06 | 07 21 29 | Rigid Board XPS 2\" | SF | {xps_2_area} | 5% | {with_waste} | $1.05 | ${amount} | $0.50 | ${amount} | ${total} | Insulation |
| IN.07 | 07 21 29 | Rigid Board Polyiso 2\" | SF | {polyiso_ins_area} | 5% | {with_waste} | $0.95 | ${amount} | $0.50 | ${amount} | ${total} | Insulation |
| IN.08 | 07 21 26 | Spray Foam Open Cell (3-1/2\") | SF | {spf_oc_area} | 10% | {with_waste} | $1.10 | ${amount} | $0.95 | ${amount} | ${total} | Insulation |
| IN.09 | 07 21 26 | Spray Foam Closed Cell (2\") | SF | {spf_cc_area} | 10% | {with_waste} | $2.40 | ${amount} | $1.20 | ${amount} | ${total} | Insulation |
| IN.10 | 22 07 19 | Pipe Insulation 1\" Fiberglass | LF | {pipe_ins_lf} | 5% | {with_waste} | $1.25 | ${amount} | $1.85 | ${amount} | ${total} | Insulation |
| IN.11 | 07 21 13 | Sound Batt (interior partitions) | SF | {sound_batt_area} | 10% | {with_waste} | $0.48 | ${amount} | $0.48 | ${amount} | ${total} | Insulation |
| IN.12 | 07 26 00 | Vapor Barrier (6mil poly) | SF | {vapor_area} | 5% | {with_waste} | $0.12 | ${amount} | $0.18 | ${amount} | ${total} | Insulation |
| IN.13 | 07 25 00 | House Wrap / Air Barrier | SF | {housewrap_area} | 5% | {with_waste} | $0.22 | ${amount} | $0.35 | ${amount} | ${total} | Insulation |

---
**Show Your Work:**
Ext. Wall Area = Perimeter × Avg Floor-to-Floor Height × Floors − Openings  
Example: 320 LF × 10' × 2 floors = 6,400 SF − 20% openings = 5,120 SF

**Division 07 — Insulation Subtotal:** ${amount}

---
"""

    div01_cleaning = ""
    if include_cleaning:
        div01_cleaning = """
## DIVISION 01 — CLEANING (CONSTRUCTION CLEANING & CLOSEOUT)
**CALCULATION SUMMARY:**
- Gross Floor Area (GFA): {gfa} SF
- Number of Floors: {floor_count}
- Exterior Surface Area (pressure wash): {ext_area} SF
- Window Count: {window_count} EA

**AREA METHODOLOGY:**
- All cleaning quantities based on Gross Floor Area of all occupied levels
- Dumpster pulls estimated at 1 pull per 2,500 SF of GFA
- Window cleaning covers both interior and exterior faces

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| CL.01 | 01 74 13 | Rough Clean (during construction) | SF | {gfa} | 0% | {gfa} | $0.05 | ${amount} | $0.18 | ${amount} | ${total} | Cleaning |
| CL.02 | 01 74 13 | Final Clean (pre-turnover) | SF | {gfa} | 0% | {gfa} | $0.08 | ${amount} | $0.42 | ${amount} | ${total} | Cleaning |
| CL.03 | 01 74 13 | Window Cleaning (int. & ext.) | SF | {window_glass_area} | 0% | {window_glass_area} | $0.05 | ${amount} | $0.65 | ${amount} | ${total} | Cleaning |
| CL.04 | 01 74 13 | Pressure Washing (exterior) | SF | {ext_area} | 0% | {ext_area} | $0.05 | ${amount} | $0.25 | ${amount} | ${total} | Cleaning |
| CL.05 | 01 74 19 | Construction Debris Removal | SF | {gfa} | 0% | {gfa} | $0.10 | ${amount} | $0.22 | ${amount} | ${total} | Cleaning |
| CL.06 | 01 74 19 | Dumpster Rental (10yd, per pull) | EA | {dumpster_count} | 0% | {dumpster_count} | $425.00 | ${amount} | $0.00 | $0.00 | ${total} | Cleaning |
| CL.07 | 01 74 13 | HEPA Vacuuming / Dust Control | SF | {gfa} | 0% | {gfa} | $0.04 | ${amount} | $0.20 | ${amount} | ${total} | Cleaning |
| CL.08 | 09 30 13 | Tile & Grout Cleaning (post-install) | SF | {tile_clean_area} | 0% | {tile_clean_area} | $0.06 | ${amount} | $0.28 | ${amount} | ${total} | Cleaning |

---
**Show Your Work:**
Dumpster Pulls = GFA ÷ 2,500 SF (round up) = {dumpster_count} pulls  
Window Glass Area = Window Count × Avg Window Area (typically 12–20 SF/window)

**Division 01 — Cleaning Subtotal:** ${amount}

---
"""

    div22 = ""
    if include_plumbing:
        div22 = """
## DIVISION 22 — PLUMBING
**FIXTURE SUMMARY:**
- Water Closets: {count}
- Lavatories: {count}
- Showers: {count}
- Kitchen Sinks: {count}
- Other Fixtures: {list}

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| 3.01 | 22 41 13 | Water Closet (Commercial) | EA | {count} | 5% | {with_waste} | $385.00 | ${amount} | $425.00 | ${amount} | ${total} | Plumbing |
| 3.02 | 22 42 13 | Lavatory (Wall-Hung) | EA | {count} | 5% | {with_waste} | $245.00 | ${amount} | $325.00 | ${amount} | ${total} | Plumbing |
| 3.03 | 22 42 39 | Shower Fixture (Complete) | EA | {count} | 5% | {with_waste} | $685.00 | ${amount} | $725.00 | ${amount} | ${total} | Plumbing |
| 3.04 | 22 11 16 | Water Supply Piping (Allowance) | SF | {floor_area} | 10% | {with_waste} | $8.00 | ${amount} | $12.00 | ${amount} | ${total} | Plumbing |
| 3.05 | 22 13 16 | DWV Piping (Allowance) | SF | {floor_area} | 10% | {with_waste} | $10.00 | ${amount} | $15.00 | ${amount} | ${total} | Plumbing |

**Division 22 Subtotal:** ${amount}

---
"""

    div23 = ""
    if include_hvac:
        div23 = """
## DIVISION 23 — HVAC
**EQUIPMENT SUMMARY:**
- Supply Diffusers: {count}
- Return Grilles: {count}
- Thermostats: {count}
- Exhaust Fans: {count}
- HVAC Units: {count and type}

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| 4.01 | 23 37 13 | Supply Air Diffuser (24\"×24\") | EA | {count} | 5% | {with_waste} | $85.00 | ${amount} | $145.00 | ${amount} | ${total} | HVAC |
| 4.02 | 23 37 13 | Return Air Grille (24\"×24\") | EA | {count} | 5% | {with_waste} | $65.00 | ${amount} | $125.00 | ${amount} | ${total} | HVAC |
| 4.03 | 23 09 23 | Thermostat (Programmable) | EA | {count} | 5% | {with_waste} | $125.00 | ${amount} | $95.00 | ${amount} | ${total} | HVAC |
| 4.04 | 23 34 23 | Exhaust Fan (Bathroom) | EA | {count} | 5% | {with_waste} | $185.00 | ${amount} | $215.00 | ${amount} | ${total} | HVAC |
| 4.05 | 23 31 13 | HVAC Ductwork (Allowance) | SF | {floor_area} | 10% | {with_waste} | $12.00 | ${amount} | $18.00 | ${amount} | ${total} | HVAC |

**Division 23 Subtotal:** ${amount}

---
"""

    div26 = ""
    if include_electrical:
        div26 = """
## DIVISION 26 — ELECTRICAL
**DEVICE SUMMARY:**
- Outlets (Standard): {count}
- GFCI Outlets: {count}
- Light Switches: {count}
- Light Fixtures: {count}
- Data Outlets: {count}
- Panels: {count and size}

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| 5.01 | 26 27 26 | Duplex Outlet (120V) | EA | {count} | 5% | {with_waste} | $8.00 | ${amount} | $45.00 | ${amount} | ${total} | Electrical |
| 5.02 | 26 27 26 | GFCI Outlet | EA | {count} | 5% | {with_waste} | $22.00 | ${amount} | $55.00 | ${amount} | ${total} | Electrical |
| 5.03 | 26 27 26 | Light Switch (Single-Pole) | EA | {count} | 5% | {with_waste} | $5.00 | ${amount} | $35.00 | ${amount} | ${total} | Electrical |
| 5.04 | 26 51 13 | LED Recessed Light (6\") | EA | {count} | 5% | {with_waste} | $35.00 | ${amount} | $85.00 | ${amount} | ${total} | Electrical |
| 5.05 | 26 52 13 | Exit Sign (LED) | EA | {count} | 5% | {with_waste} | $85.00 | ${amount} | $95.00 | ${amount} | ${total} | Electrical |
| 5.06 | 26 28 13 | Smoke Detector (Hardwired) | EA | {count} | 5% | {with_waste} | $65.00 | ${amount} | $95.00 | ${amount} | ${total} | Electrical |
| 5.07 | 26 05 26 | Conduit & Wire (Allowance) | SF | {floor_area} | 10% | {with_waste} | $6.00 | ${amount} | $10.00 | ${amount} | ${total} | Electrical |

**Division 26 Subtotal:** ${amount}

---
"""

    div06_finish_carpentry = ""
    if include_finish_carpentry:
        div06_finish_carpentry = """
## DIVISION 06 — FINISH CARPENTRY & MILLWORK
**CALCULATION SUMMARY:**
- Base Molding: {base_mold_lf} LF
- Crown Molding: {crown_mold_lf} LF
- Door Casings: {door_casing_count} EA
- Window Stools & Aprons: {window_stool_count} EA
- Stair Treads / Risers: {tread_count} EA / {riser_count} EA
- Built-In Cabinetry: {cabinet_lf} LF (base) / {upper_cabinet_lf} LF (upper)
- Countertops: {countertop_lf} LF

**QUANTITY METHODOLOGY:**
- Base molding LF = room perimeter − door opening widths (typically 3 LF per door deducted)
- Crown molding LF = ceiling perimeter of applicable rooms
- Door casings: both sides of every door leaf (interior swing doors)
- Window stool/apron: one set per window opening
- Stair treads/risers: count from stair run length and rise height per drawing

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| FC.01 | 06 22 00 | Base Molding — Painted MDF 3-1/2\" | LF | {base_mold_lf} | 10% | {with_waste} | $1.20 | ${amount} | $1.85 | ${amount} | ${total} | Finish Carpentry |
| FC.02 | 06 22 00 | Crown Molding — Painted MDF 3-1/2\" | LF | {crown_mold_lf} | 10% | {with_waste} | $1.65 | ${amount} | $2.50 | ${amount} | ${total} | Finish Carpentry |
| FC.03 | 06 22 00 | Door Casing Set — Painted MDF | EA | {door_casing_count} | 5% | {with_waste} | $28.00 | ${amount} | $45.00 | ${amount} | ${total} | Finish Carpentry |
| FC.04 | 06 22 00 | Window Stool & Apron — Painted MDF | EA | {window_stool_count} | 5% | {with_waste} | $22.00 | ${amount} | $38.00 | ${amount} | ${total} | Finish Carpentry |
| FC.05 | 06 22 00 | Chair Rail (Painted MDF, 2-1/2\") | LF | {chair_rail_lf} | 10% | {with_waste} | $0.95 | ${amount} | $1.65 | ${amount} | ${total} | Finish Carpentry |
| FC.06 | 06 41 00 | Built-In Cabinetry — Base (per LF) | LF | {base_cabinet_lf} | 5% | {with_waste} | $185.00 | ${amount} | $95.00 | ${amount} | ${total} | Finish Carpentry |
| FC.07 | 06 41 00 | Built-In Cabinetry — Upper (per LF) | LF | {upper_cabinet_lf} | 5% | {with_waste} | $145.00 | ${amount} | $85.00 | ${amount} | ${total} | Finish Carpentry |
| FC.08 | 06 41 00 | Countertop — Laminate | LF | {lam_counter_lf} | 5% | {with_waste} | $38.00 | ${amount} | $22.00 | ${amount} | ${total} | Finish Carpentry |
| FC.09 | 06 41 00 | Countertop — Quartz / Solid Surface | LF | {quartz_counter_lf} | 5% | {with_waste} | $120.00 | ${amount} | $45.00 | ${amount} | ${total} | Finish Carpentry |
| FC.10 | 06 43 13 | Stair Treads (Oak) | EA | {tread_count} | 5% | {with_waste} | $65.00 | ${amount} | $55.00 | ${amount} | ${total} | Finish Carpentry |
| FC.11 | 06 43 13 | Stair Risers (MDF Painted) | EA | {riser_count} | 5% | {with_waste} | $18.00 | ${amount} | $35.00 | ${amount} | ${total} | Finish Carpentry |
| FC.12 | 06 43 13 | Handrail — Wood Wall-Mounted | LF | {wood_rail_lf} | 5% | {with_waste} | $14.00 | ${amount} | $18.00 | ${amount} | ${total} | Finish Carpentry |
| FC.13 | 06 10 00 | Blocking & Nailers (Allowance) | SF | {total_floor_area} | 5% | {with_waste} | $0.15 | ${amount} | $0.25 | ${amount} | ${total} | Finish Carpentry |

---
**Show Your Work:**
Base Molding LF = Sum of room perimeters − (door count × 3 LF per opening)  
Example: 10 rooms avg perimeter 48 LF × 10 = 480 LF − (15 doors × 3 LF) = 435 LF

**Division 06 — Finish Carpentry Subtotal:** ${amount}

---
"""

    div08_windows = ""
    if include_windows:
        div08_windows = """
## DIVISION 08 — WINDOWS INSTALLATION
**CALCULATION SUMMARY:**
- Total Window Count: {window_count} EA
- Vinyl Windows: {vinyl_window_count} EA
- Aluminum / Storefront: {storefront_sf} SF
- Egress Windows: {egress_count} EA
- Window Flashing Sets: {window_count} EA

**QUANTITY METHODOLOGY:**
- Count all window symbols on drawing by type and size
- Storefront / curtain wall measured as gross SF (width × height of glazed opening)
- Egress windows identified by minimum code size callout or label
- Flashing and casing counted equal to total window count

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| WN.01 | 08 51 13 | Single-Hung Window 2'-0\"×3'-0\" (Vinyl) | EA | {sh_sm_count} | 0% | {sh_sm_count} | $185.00 | ${amount} | $145.00 | ${amount} | ${total} | Windows |
| WN.02 | 08 51 13 | Single-Hung Window 2'-6\"×4'-0\" (Vinyl) | EA | {sh_md_count} | 0% | {sh_md_count} | $225.00 | ${amount} | $165.00 | ${amount} | ${total} | Windows |
| WN.03 | 08 51 13 | Double-Hung Window 3'-0\"×5'-0\" (Vinyl) | EA | {dh_count} | 0% | {dh_count} | $310.00 | ${amount} | $185.00 | ${amount} | ${total} | Windows |
| WN.04 | 08 51 13 | Casement Window 2'-0\"×4'-0\" (Vinyl) | EA | {cas_count} | 0% | {cas_count} | $265.00 | ${amount} | $175.00 | ${amount} | ${total} | Windows |
| WN.05 | 08 51 13 | Fixed Picture Window 4'-0\"×5'-0\" (Vinyl) | EA | {fixed_count} | 0% | {fixed_count} | $355.00 | ${amount} | $195.00 | ${amount} | ${total} | Windows |
| WN.06 | 08 51 13 | Awning Window 2'-6\"×2'-0\" (Vinyl) | EA | {awn_count} | 0% | {awn_count} | $215.00 | ${amount} | $155.00 | ${amount} | ${total} | Windows |
| WN.07 | 08 51 13 | Egress Window (Min. Code Size, Vinyl) | EA | {egress_count} | 0% | {egress_count} | $375.00 | ${amount} | $225.00 | ${amount} | ${total} | Windows |
| WN.08 | 08 43 13 | Storefront Window System | SF | {storefront_sf} | 5% | {with_waste} | $38.00 | ${amount} | $28.00 | ${amount} | ${total} | Windows |
| WN.09 | 07 62 00 | Window Flashing & Sealant | EA | {window_count} | 0% | {window_count} | $18.00 | ${amount} | $35.00 | ${amount} | ${total} | Windows |
| WN.10 | 06 22 00 | Window Trim & Casing (Interior) | EA | {window_count} | 5% | {with_waste} | $28.00 | ${amount} | $38.00 | ${amount} | ${total} | Windows |

---
**Show Your Work:**
Total Windows = Count from drawing symbols by type  
Storefront SF = Width × Height of each glazed assembly  
Egress Windows = Count openings meeting min. 5.7 SF net clear area per code

**Division 08 — Windows Installation Subtotal:** ${amount}

---
"""

    div08_doors = ""
    if include_doors:
        div08_doors = """
## DIVISION 08 — DOORS INSTALLATION
**CALCULATION SUMMARY:**
- Total Door Count: {total_door_count} EA
- Interior Doors: {int_door_count} EA
- Exterior Doors: {ext_door_count} EA
- Fire-Rated Doors: {fire_door_count} EA
- Hardware Sets Required: {hardware_count} EA

**QUANTITY METHODOLOGY:**
- Count all door symbols on plan by leaf size and type
- Interior hollow-core: typical bedrooms / offices
- Interior solid-core: corridors, utility, acoustic
- Exterior: all building entry / egress points
- Fire-rated: stairwells, mechanical, rated corridors
- Hardware set counted per door leaf (not per opening)

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| DR.01 | 08 14 16 | Interior Door 3'-0\"×6'-8\" (Hollow Core) | EA | {int_hc_count} | 0% | {int_hc_count} | $85.00 | ${amount} | $107.00 | ${amount} | ${total} | Doors |
| DR.02 | 08 14 16 | Interior Door 3'-0\"×6'-8\" (Solid Core) | EA | {int_sc_count} | 0% | {int_sc_count} | $145.00 | ${amount} | $120.00 | ${amount} | ${total} | Doors |
| DR.03 | 08 14 16 | Interior Door 3'-0\"×8'-0\" (Solid Core) | EA | {int_sc_8_count} | 0% | {int_sc_8_count} | $185.00 | ${amount} | $135.00 | ${amount} | ${total} | Doors |
| DR.04 | 08 14 16 | Interior Door 2'-6\"×6'-8\" (Hollow Core) | EA | {int_hc_26_count} | 0% | {int_hc_26_count} | $75.00 | ${amount} | $100.00 | ${amount} | ${total} | Doors |
| DR.05 | 08 14 16 | Bifold Door Pair 3'-0\"×6'-8\" | EA | {bifold_count} | 0% | {bifold_count} | $95.00 | ${amount} | $85.00 | ${amount} | ${total} | Doors |
| DR.06 | 08 14 33 | Sliding Barn Door 4'-0\"×8'-0\" | EA | {barn_count} | 0% | {barn_count} | $285.00 | ${amount} | $195.00 | ${amount} | ${total} | Doors |
| DR.07 | 08 14 16 | Exterior Door 3'-0\"×6'-8\" (Fiberglass) | EA | {ext_fg_count} | 0% | {ext_fg_count} | $325.00 | ${amount} | $195.00 | ${amount} | ${total} | Doors |
| DR.08 | 08 14 16 | Exterior Door 3'-0\"×6'-8\" (Steel Insulated) | EA | {ext_st_count} | 0% | {ext_st_count} | $245.00 | ${amount} | $185.00 | ${amount} | ${total} | Doors |
| DR.09 | 08 36 13 | Patio Sliding Door 6'-0\"×6'-8\" (Vinyl) | EA | {patio_count} | 0% | {patio_count} | $595.00 | ${amount} | $265.00 | ${amount} | ${total} | Doors |
| DR.10 | 08 11 16 | Fire-Rated Door 3'-0\"×7'-0\" (20-min HM) | EA | {fire_20_count} | 0% | {fire_20_count} | $465.00 | ${amount} | $225.00 | ${amount} | ${total} | Doors |
| DR.11 | 08 11 16 | Fire-Rated Door 3'-0\"×7'-0\" (90-min HM) | EA | {fire_90_count} | 0% | {fire_90_count} | $685.00 | ${amount} | $265.00 | ${amount} | ${total} | Doors |
| DR.12 | 08 71 00 | Door Hardware Set (Residential Grade) | EA | {hw_res_count} | 0% | {hw_res_count} | $85.00 | ${amount} | $45.00 | ${amount} | ${total} | Doors |
| DR.13 | 08 71 00 | Door Hardware Set (Commercial Grade) | EA | {hw_com_count} | 0% | {hw_com_count} | $185.00 | ${amount} | $65.00 | ${amount} | ${total} | Doors |
| DR.14 | 08 71 00 | Door Closer (Commercial) | EA | {closer_count} | 0% | {closer_count} | $95.00 | ${amount} | $75.00 | ${amount} | ${total} | Doors |
| DR.15 | 08 11 13 | Door Frame — Steel KD | EA | {steel_frame_count} | 0% | {steel_frame_count} | $95.00 | ${amount} | $85.00 | ${amount} | ${total} | Doors |
| DR.16 | 08 11 13 | Weatherstripping (Exterior Doors) | EA | {ext_door_count} | 0% | {ext_door_count} | $22.00 | ${amount} | $28.00 | ${amount} | ${total} | Doors |

---
**Show Your Work:**
Interior Door Count = Total door symbols on floor plan − exterior and fire-rated  
Fire-Rated Doors = Doors at rated wall assemblies (stairwells, corridors, mechanical)  
Hardware sets = 1 per door leaf; commercial grade at all exterior and fire-rated doors

**Division 08 — Doors Installation Subtotal:** ${amount}

---
"""

    div07_siding = ""
    if include_siding:
        div07_siding = """
## DIVISION 07 — SIDING INSTALLATION (EXTERIOR CLADDING)
**CALCULATION SUMMARY:**
- Gross Exterior Wall Area: {ext_wall_area} SF
- Net Siding Area (minus openings): {net_siding_area} SF
- Corner Trim: {corner_trim_lf} LF
- Soffit Area: {soffit_area} SF
- Fascia: {fascia_lf} LF
- Siding Type: {siding_type}

**AREA METHODOLOGY:**
- Gross exterior wall area = building perimeter × floor-to-floor height × number of floors
- Deduct window and door openings (typically 15–20% of gross wall area)
- Corner trim = building height × number of outside corners × 2
- Soffit area = overhang depth × building perimeter
- Fascia LF = building perimeter (at eave/rake)

| Item # | CSI Ref. | Description | Unit | Quantity | Wastage % | Qty w/ Wastage | Unit Material | Total Material | Unit Labor | Total Labor | Total Cost | Trade |
|--------|----------|-------------|------|----------|-----------|----------------|---------------|----------------|------------|-------------|------------|-------|
| SD.01 | 07 46 13 | Vinyl Siding (Lap, .044\" Profile) | SF | {vinyl_siding_sf} | 10% | {with_waste} | $1.45 | ${amount} | $1.85 | ${amount} | ${total} | Siding |
| SD.02 | 07 46 23 | Fiber Cement Siding — Lap (HardiePlank) | SF | {fc_lap_sf} | 10% | {with_waste} | $2.85 | ${amount} | $2.65 | ${amount} | ${total} | Siding |
| SD.03 | 07 46 23 | Fiber Cement Panel (HardiePanel) | SF | {fc_panel_sf} | 10% | {with_waste} | $2.65 | ${amount} | $2.45 | ${amount} | ${total} | Siding |
| SD.04 | 07 46 33 | LP SmartSide (Lap, Engineered Wood) | SF | {lp_smart_sf} | 10% | {with_waste} | $2.45 | ${amount} | $2.25 | ${amount} | ${total} | Siding |
| SD.05 | 07 46 46 | Cedar Bevel Siding (1\"×6\", Clear) | SF | {cedar_sf} | 10% | {with_waste} | $4.85 | ${amount} | $3.25 | ${amount} | ${total} | Siding |
| SD.06 | 07 24 13 | Stucco (3-Coat System) | SF | {stucco_sf} | 5% | {with_waste} | $2.80 | ${amount} | $4.50 | ${amount} | ${total} | Siding |
| SD.07 | 07 24 19 | EIFS / Dryvit System | SF | {eifs_sf} | 5% | {with_waste} | $3.50 | ${amount} | $4.85 | ${amount} | ${total} | Siding |
| SD.08 | 04 21 13 | Brick Veneer (Modular) | SF | {brick_sf} | 5% | {with_waste} | $9.50 | ${amount} | $12.50 | ${amount} | ${total} | Siding |
| SD.09 | 04 43 00 | Stone Veneer (Manufactured, Thin) | SF | {stone_sf} | 5% | {with_waste} | $8.50 | ${amount} | $10.50 | ${amount} | ${total} | Siding |
| SD.10 | 07 42 13 | Metal Panel Siding (ACM, 4mm) | SF | {metal_panel_sf} | 5% | {with_waste} | $12.50 | ${amount} | $9.50 | ${amount} | ${total} | Siding |
| SD.11 | 07 25 00 | House Wrap / Weather Barrier | SF | {net_siding_area} | 5% | {with_waste} | $0.22 | ${amount} | $0.35 | ${amount} | ${total} | Siding |
| SD.12 | 07 46 13 | Corner Trim (Vinyl or Fiber Cement) | LF | {corner_trim_lf} | 5% | {with_waste} | $1.85 | ${amount} | $1.45 | ${amount} | ${total} | Siding |
| SD.13 | 07 71 23 | Soffit (Vinyl, Vented) | SF | {soffit_area} | 10% | {with_waste} | $1.65 | ${amount} | $1.85 | ${amount} | ${total} | Siding |
| SD.14 | 06 20 00 | Fascia Board (PVC, 5/4\"×6\") | LF | {fascia_lf} | 5% | {with_waste} | $2.85 | ${amount} | $2.25 | ${amount} | ${total} | Siding |
| SD.15 | 07 92 00 | Siding Caulking & Sealant (Allowance) | SF | {net_siding_area} | 0% | {net_siding_area} | $0.12 | ${amount} | $0.18 | ${amount} | ${total} | Siding |

---
**Show Your Work:**
Gross Ext. Wall Area = Perimeter × Floor-to-Floor Height × Floors  
Example: 200 LF perimeter × 10' height × 2 floors = 4,000 SF − 18% openings = 3,280 SF net  
Corner Trim = Building Height × Outside Corner Count × 1 LF per corner

**Division 07 — Siding Installation Subtotal:** ${amount}

---
"""

    financial = """
## FINANCIAL SUMMARY
| Description | Amount |
|-------------|--------|
| Division 01 - General Requirements | $0.00 |
| Division 05/06 - Framing | ${subtotal} |
| Division 06 - Finish Carpentry | ${subtotal} |
| Division 07 - Roofing | ${subtotal} |
| Division 07 - Insulation | ${subtotal} |
| Division 07 - Siding Installation | ${subtotal} |
| Division 08 - Windows Installation | ${subtotal} |
| Division 08 - Doors Installation | ${subtotal} |
| Division 09 - Finishes (Painting) | ${subtotal} |
| Division 09 - Drywall | ${subtotal} |
| Division 09 - Flooring | ${subtotal} |
| Division 22 - Plumbing | ${subtotal} |
| Division 23 - HVAC | ${subtotal} |
| Division 26 - Electrical | ${subtotal} |
| Division 01 - Cleaning | ${subtotal} |
| **SUBTOTAL** | **${amount}** |
| Insurance (5%) | ${amount} |
| Contingency (5%) | ${amount} |
| Overhead & Profit (20%) | ${amount} |
| **PROJECT TOTAL** | **${total}** |

---
"""

    assumptions = """
## ASSUMPTIONS & NOTES
**VERIFIED DATA:**
- List all dimensions extracted directly from PDF
- Note room counts confirmed by labels
- Identify scale used for calculations
- List MEP fixtures counted from symbols/legends

**ASSUMPTIONS MADE:**
- Ceiling height: 9'-0\" (unless noted otherwise)
- Wall deductions: 15% for doors/windows
- Paint coverage rates based on manufacturer specs
- Labor productivity rates based on RSMeans 2025
- MEP fixture counts based on typical building code requirements where symbols not shown
- HVAC/Plumbing/Electrical allowances applied where detailed drawings not provided
- Drywall: both sides of all partitions counted unless single-side finish noted
- Flooring: finish type per room label; tile in all wet areas unless schedule shown
- Framing: metal studs for all interior non-load-bearing partitions; wood framing for exterior where noted
- Roofing: TPO assumed unless membrane type is shown; insulation R-value per energy code
- Insulation: R-13 batts in all exterior walls; R-30 at ceiling/roof unless noted otherwise
- Cleaning: 1 dumpster pull per 2,500 SF GFA; final clean includes all floors, surfaces, and glass
- Finish Carpentry: painted MDF assumed for base/crown/casings unless wood finish schedule noted; stair treads oak, risers MDF painted
- Windows: vinyl assumed unless aluminum or wood noted on drawings; storefront measured by SF; egress per code min. 5.7 SF net
- Doors: interior hollow-core for bedrooms/offices, solid-core for corridors; exterior fiberglass unless steel noted; fire-rated at all rated assemblies
- Siding: fiber cement lap (HardiePlank) assumed unless material noted on exterior elevations; house wrap applied under all siding

**ITEMS REQUIRING FIELD VERIFICATION:**
- List any unclear measurements
- Note spaces where dimensions weren't visible
- Confirm MEP fixture types and specifications
- Verify electrical panel sizes and locations
- Confirm HVAC equipment capacity requirements
- Confirm roofing membrane type and insulation R-value from project specifications
- Verify framing gauge and spacing per structural engineer's drawings
- Confirm drywall finish level (Level 4 vs Level 5) per finish schedule

**EXCLUSIONS:**
- Specialized finishes not indicated on drawings
- Furniture, fixtures, or equipment (FF&E)
- Site work beyond items shown on plan
- Fire suppression systems (unless shown)
- Low-voltage systems beyond basic data outlets
- Specialized mechanical systems (commercial kitchen, medical gas, etc.)
- Exterior cladding / façade systems
- Foundation and structural slab work

**QUALIFICATIONS:**
- Estimate valid for 30 days from date of issue
- Pricing based on current market conditions
- Assumes single-shift work, normal working hours
- MEP costs are preliminary allowances pending engineered drawings
"""

    # ── Assemble output ────────────────────────────────────────────────────────
    output = (
        header
        + div01
        + div06_framing
        + div06_finish_carpentry
        + div07_roofing
        + div07_insulation
        + div07_siding
        + div08_windows
        + div08_doors
        + div09_finishes
        + div09_drywall
        + div09_flooring
        + div22
        + div23
        + div26
        + div01_cleaning
        + financial
        + assumptions
    )

    # Replace placeholder with the constructed scope description
    output = output.replace("{scope_description}", scope_desc)
    return output




def build_estimation_prompt(scopes) -> str:
    """
    Build the full estimation prompt based on selected scopes.
    `scopes` can be:
        - "Overall"
        - A single string (e.g. "Finishes")
        - A list of divisions (e.g. ["Finishes", "Drywall"])
    """

    # Normalize input
    if isinstance(scopes, str):
        scopes = [scopes]

    base = """You are a Senior Construction Estimator specializing in CSI Format commercial projects with 20+ years of experience. Your expertise includes:
- Accurate quantity takeoffs from architectural drawings
- CSI MasterFormat cost coding
- Material and labor cost estimation
- Commercial construction standards and practices

TASK: Analyze this construction PDF floor plan and produce a complete, professionally structured construction cost estimate.
"""

    div_map = {
        "Finishes":        ("09",    "FINISHES — PAINTING"),
        "Drywall":         ("09",    "DRYWALL — GYPSUM BOARD"),
        "Flooring":        ("09",    "FLOORING"),
        "Framing":         ("05/06", "FRAMING — ROUGH CARPENTRY & METAL STUDS"),
        "Roofing":         ("07",    "ROOFING"),
        "Insulation":      ("07",    "INSULATION"),
        "Cleaning":        ("01",    "CLEANING — CONSTRUCTION CLEANING & CLOSEOUT"),
        "Plumbing":        ("22",    "PLUMBING"),
        "HVAC":            ("23",    "HVAC"),
        "Electrical":      ("26",    "ELECTRICAL"),
        "FinishCarpentry": ("06",    "FINISH CARPENTRY & MILLWORK"),
        "Windows":         ("08",    "WINDOWS INSTALLATION"),
        "Doors":           ("08",    "DOORS INSTALLATION"),
        "Siding":          ("07",    "SIDING INSTALLATION"),
    }

    # ── OVERALL SELECTED ─────────────────────────
    if "Overall" in scopes:
        scope_directive = (
            "Generate a FULL construction cost estimate including ALL divisions "
            "(01, 05/06, 06 Finish Carpentry, 07 Roofing, 07 Insulation, 07 Siding, "
            "08 Windows, 08 Doors, 09 Painting, 09 Drywall, 09 Flooring, 22, 23, 26)."
        )
        selected_scopes = list(div_map.keys())

    else:
        selected_scopes = scopes

        division_list_text = "\n".join(
            [f"- Division {div_map[s][0]} — {div_map[s][1]}" for s in selected_scopes]
        )

        scope_directive = f"""
IMPORTANT:
Generate a construction cost estimate focusing ONLY on the following divisions:

{division_list_text}

Do NOT include other divisions.
Include detailed tables for each selected division and the FINANCIAL SUMMARY.
Use the exact cost database provided below.
"""

    # Build output format dynamically
    output_format = build_output_format_section(selected_scopes)

    full_prompt = (
        base
        + "\n"
        + "You are analyzing a SCALED ARCHITECTURAL DRAWING, not a text document.\n"
          "Precision is more important than completeness.\n"
          "If uncertain, exclude the item rather than assuming.\n\n"
        + scope_directive + "\n"
        + VISUAL_ANALYSIS_PROTOCOL + "\n"
        + DATA_VERIFICATION_RULES + "\n"
        + GEOMETRY_VALIDATION + "\n"
        + ANALYSIS_METHODOLOGY + "\n"
        + COST_DATABASE_SECTION + "\n"
        + "═══════════════════════════════════════════════════════════════════════\n"
          "CALCULATION INTEGRITY RULE\n"
          "═══════════════════════════════════════════════════════════════════════\n"
          "- Show formula before final number for all major area calculations.\n"
          "- Verify multiplication and totals before presenting results.\n"
          "- Ensure each Division subtotal equals sum of its line items.\n"
          "- Ensure Financial Summary totals are mathematically accurate.\n\n"
        + output_format + "\n\n"
        + "IMPORTANT:\n"
          "- Return ONLY the structured markdown output.\n"
          "- Do NOT include analysis commentary.\n"
          "- Do NOT explain methodology.\n"
          "- Do NOT add extra text before or after the estimate.\n\n"
          "Begin analysis now. Process the uploaded PDF systematically following the methodology above."
    )

    return full_prompt




def build_json_extraction_prompt() -> str:
    """
    Generic JSON extraction prompt that enforces a detailed technical description
    for every table. Works with any set of divisions.
    """
    return """Based on the construction estimate provided above, extract ALL tables and return them in pure JSON format.

Return this exact structure:
{
  "tables": [
    {
      "table_name": "exact title of the table as it appears in the markdown (e.g., DIVISION 09 — FINISHES)",
      
      "description": "### Architectural & Technical Description\\n\\nProvide a **detailed, technical, and descriptive specification** extracted or logically inferred from the estimate, architectural drawings analysis, finish schedules, general notes, and typical details included in the estimate.\\n\\nThe description MUST be written in professional construction language and include the following sections:\\n\\n#### Scope of Work\\nClearly describe the full scope of work covered by this division, including included and excluded items.\\n\\n#### Materials & Finishes\\nDescribe all finishes and materials such as wall finishes, paint systems, coating types, finish levels, material grades, and applicable standards. Reference the cost database and quantities from the table.\\n\\n#### Installation & Application\\nExplain application and installation methods, workmanship requirements, sequencing, tolerances, and coordination with adjacent trades.\\n\\n#### Surface Preparation\\nDetail surface preparation requirements including cleaning, patching, sanding, priming, moisture control, and substrate readiness.\\n\\n#### Drawings & Notes Reference\\nReference the drawing scale, project information, and any assumptions made during quantity takeoff. Integrate the table's quantities and unit costs into the narrative.\\n\\nIf the estimate does not explicitly state values, make **clear industry-standard assumptions** and state them explicitly. Generic summaries are NOT acceptable.",
      
      "headers": ["column1", "column2", ...],
      "rows": [
        {
          "column1": "value",
          "column2": "value",
          ...
        }
      ]
    }
  ]
}

CRITICAL REQUIREMENTS:
- Extract EVERY table you see in the estimate (including division tables, financial summary, etc.).
- EACH extracted table MUST include a "description" field.

DESCRIPTION ENFORCEMENT:
- The "description" field is MANDATORY for EVERY table.
- Length MUST be between 500 and 1000 words PER table.
- Content MUST be:
  - Highly descriptive
  - Technically detailed
  - Written in professional architectural / construction specification language
  - Table data (quantities, costs, units) MUST be integrated into the description to support technical details and specifications.
- Generic, high-level, or summary-style descriptions are STRICTLY NOT allowed.

TECHNICAL CONTENT REQUIREMENTS (apply where relevant):
- Wall finishes (materials, finish levels, locations)
- Paint schedules (paint type, finish, color reference if stated, number of coats)
- Coating systems (primers, intermediate coats, protective finishes)
- Molding, trim, and decorative elements (baseboards, crown molding, reveals, transitions)
- Surface preparation instructions (cleaning, patching, sanding, priming, moisture treatment)
- MEP fixture specifications, mounting heights, wiring methods, etc.
- Any other technical details present in the estimate.

ASSUMPTIONS:
- If specific data is missing, apply industry-standard assumptions.
- All assumptions MUST be clearly stated within the description.
- NEVER state that information is missing or unavailable.

FORMAT RULES:
- Markdown formatting is ALLOWED inside the "description" field ONLY.
- Return ONLY valid JSON.
- Do NOT include markdown, explanations, or commentary outside JSON.
- Preserve all dollar amounts, quantities, units, and percentages EXACTLY as provided.
- Do NOT recalculate, normalize, or modify any numeric values.

STRUCTURE REQUIREMENTS:
- Each table MUST contain:
  - table_name
  - description
  - headers
  - rows
- Each row MUST include ALL column values exactly as shown in the source.

Return PURE JSON only."""