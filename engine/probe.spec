# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — bundle the Probe Python engine as a standalone binary."""

import os
import sys

block_cipher = None

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'probe.codex_adapter',
        'probe.codex_adapter.reader',
        'probe.codex_adapter.classifier',
        'probe.codex_adapter.extractors',
        'probe.codex_adapter.models',
        'probe.codex_adapter.token_estimator',
        'probe.codex_adapter.summary',
        'probe.codex_adapter.writer',
        'probe.storage',
        'probe.storage.connection',
        'probe.storage.schema',
        'probe.storage.session_dao',
        'probe.storage.event_dao',
        'probe.storage.rule_result_dao',
        'probe.storage.import_dao',
        'probe.handlers',
        'probe.handlers.import_handler',
        'probe.handlers.session_handler',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'numpy', 'scipy', 'pandas'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='probe-engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_subsystem=False,
)
