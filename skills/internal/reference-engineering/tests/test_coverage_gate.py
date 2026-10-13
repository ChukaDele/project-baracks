import copy
import csv
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from coverage_gate import audit, COLUMNS

NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def write_csv(path, rows):
    if not rows:
        raise AssertionError('Test fixtures need headers')
    with path.open('w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.root = Path(self.t.name) / 'reference'
        self.root.mkdir()
        self.project = {
            'title': 'Test app', 'mode': 'owned', 'phase': 'release',
            'parity_goal': 'full', 'source_types': ['website'], 'platforms': ['desktop-web'],
            'scope': 'Booking create and view with owned dataset', 'source_origin': 'owner-site', 'interactive': True,
            'data_in_scope': True, 'visual_in_scope': True,
            'source_last_checked_at': NOW, 'freshness_policy_days': 7, 'deployment_approved': False, 'target_revision': 'ref-test-revision-1', 'min_visual_score': 85,
            'ownership_evidence_id': 'E_OWN', 'authorization_evidence_id': '', 'scope_approval_evidence_id': '',
            'remote_preview_url': 'https://fixture-preview.invalid', 'noninteractive_rationale': '', 'local_testing_exception': ''
        }
        self.tables = {
            'evidence': [
                {'evidence_id': 'E_SOURCE', 'status': 'observed', 'source_uri': 'owner-site/settings', 'captured_at': NOW, 'screen_or_state': 'S01;FL01;F01;C01;V01', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_DOC', 'status': 'documented', 'source_uri': 'public-help', 'captured_at': NOW, 'screen_or_state': 'F02;D01', 'confidentiality': 'public', 'notes': ''},
                {'evidence_id': 'E_TARGET', 'status': 'observed', 'source_uri': 'test-results/screen-S01.png', 'captured_at': NOW, 'screen_or_state': 'S01', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_FLOW', 'status': 'observed', 'source_uri': 'test-results/flow-FL01.json', 'captured_at': NOW, 'screen_or_state': 'FL01', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_FEATURE1', 'status': 'observed', 'source_uri': 'test-results/feature-F01.json', 'captured_at': NOW, 'screen_or_state': 'F01', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_FEATURE2', 'status': 'observed', 'source_uri': 'test-results/feature-F02.json', 'captured_at': NOW, 'screen_or_state': 'F02', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_CONTROL', 'status': 'observed', 'source_uri': 'test-results/control-C01.json', 'captured_at': NOW, 'screen_or_state': 'C01', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_TARGET_DB', 'status': 'observed', 'source_uri': 'test-results/counts.txt', 'captured_at': NOW, 'screen_or_state': 'D01', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_VISUAL', 'status': 'observed', 'source_uri': 'test-results/visual.png', 'captured_at': NOW, 'screen_or_state': 'S01;V01', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_OWN', 'status': 'documented', 'source_uri': 'permission/owner-record.md', 'captured_at': NOW, 'screen_or_state': 'OWN', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_AUTH', 'status': 'documented', 'source_uri': 'permission/authorized-record.md', 'captured_at': NOW, 'screen_or_state': 'AUTH', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_RIGHTS', 'status': 'documented', 'source_uri': 'permission/rights-D01.md', 'captured_at': NOW, 'screen_or_state': 'RIGHTS;D01', 'confidentiality': 'internal', 'notes': ''},
                {'evidence_id': 'E_SCOPE', 'status': 'documented', 'source_uri': 'permission/scope-approval.md', 'captured_at': NOW, 'screen_or_state': 'SCOPE', 'confidentiality': 'internal', 'notes': ''},
            ],
            'screens': [
                {'screen_id':'S01','route':'/bookings','role':'member','auth_tier':'member','state':'filled','viewport':'1440x900','source_status':'observed','source_evidence_id':'E_SOURCE','target_status':'pass','target_evidence_id':'E_TARGET','notes':''},
            ],
            'flows': [
                {'flow_id':'FL01','description':'Make a booking','screen_ids':'S01','priority':'must','source_status':'observed','source_evidence_id':'E_SOURCE','target_status':'pass','target_evidence_id':'E_FLOW','test_id':'T04','notes':''},
            ],
            'features': [
                {'feature_id':'F01','description':'Book appointment','priority':'must','source_status':'observed','source_evidence_id':'E_SOURCE','target_status':'pass','target_evidence_id':'E_FEATURE1','test_id':'T01','notes':''},
                {'feature_id':'F02','description':'Retrieve bookings','priority':'should','source_status':'documented','source_evidence_id':'E_DOC','target_status':'pass','target_evidence_id':'E_FEATURE2','test_id':'T02','notes':''},
            ],
            'controls': [
                {'control_id':'C01','screen_id':'S01','role':'member','auth_tier':'member','interaction_state':'filled','label':'Save','source_status':'observed','source_evidence_id':'E_SOURCE','target_status':'pass','target_evidence_id':'E_CONTROL','backend_dependency':'POST /bookings','data_dependency':'D01','test_id':'T03','notes':''},
            ],
            'data': [
                {'dataset_id':'D01','description':'Owned bookings','required':'yes','rights':'owned','rights_evidence_id':'E_RIGHTS','expected_count':'30','actual_count':'30','status':'verified','source_evidence_id':'E_DOC','target_evidence_id':'E_TARGET_DB','refresh_strategy':'source export','notes':''},
            ],
            'findings': [
                {'finding_id':'B01','severity':'low','status':'open','description':'minor spacing','evidence_id':'E_VISUAL','notes':'accepted backlog'},
            ],
            'tests': [
                {'test_id':'T01','requirement_id':'F01','result':'pass','command':'npx playwright test booking','ran_at':NOW,'revision':'ref-test-revision-1','evidence_id':'E_FEATURE1','notes':''},
                {'test_id':'T02','requirement_id':'F02','result':'pass','command':'npm run test bookings','ran_at':NOW,'revision':'ref-test-revision-1','evidence_id':'E_FEATURE2','notes':''},
                {'test_id':'T03','requirement_id':'C01','result':'pass','command':'npx playwright test save-button','ran_at':NOW,'revision':'ref-test-revision-1','evidence_id':'E_CONTROL','notes':''},
                {'test_id':'T04','requirement_id':'FL01','result':'pass','command':'npx playwright test booking-journey','ran_at':NOW,'revision':'ref-test-revision-1','evidence_id':'E_FLOW','notes':''},
            ],
            'visual_checks': [
                {'check_id':'V01','screen_id':'S01','viewport':'1440x900','state':'filled','source_evidence_id':'E_SOURCE','target_evidence_id':'E_VISUAL','metric':'layout regional diff','score':'95.5','result':'pass','notes':'reviewed captured images'},
            ],
        }
        target_ids = {'E_TARGET','E_FLOW','E_FEATURE1','E_FEATURE2','E_CONTROL','E_TARGET_DB','E_VISUAL'}
        for ev in self.tables['evidence']:
            ev['revision'] = 'ref-test-revision-1' if ev['evidence_id'] in target_ids else ''
        self.persist()

    def tearDown(self):
        self.t.cleanup()

    def persist(self):
        (self.root / 'project.json').write_text(json.dumps(self.project), encoding='utf-8')
        for name, rows in self.tables.items():
            if rows:
                write_csv(self.root / (name + '.csv'), rows)
            else:
                (self.root / (name + '.csv')).write_text(','.join(COLUMNS[name])+'\n', encoding='utf-8')

    def test_happy_full_release(self):
        x = audit(self.root, 'release')
        self.assertTrue(x['passed'], x['errors'])
        self.assertEqual(x['features']['verified'], 2)
        self.assertEqual(x['required_data']['verified'], 1)

    def test_gate_does_not_fake_release_from_recon(self):
        self.tables['features'][0]['target_status'] = 'not_started'
        self.tables['features'][0]['target_evidence_id'] = ''
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])
        self.assertTrue(audit(self.root, 'recon')['passed'])

    def test_blocked_source_action_rejected(self):
        self.tables['controls'][0]['source_status'] = 'blocked'
        self.tables['evidence'][0]['status'] = 'blocked'
        self.tables['features'][0]['source_status'] = 'blocked'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_missing_must_rejected(self):
        self.tables['features'][0]['target_status'] = 'missing'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_mvp_allows_unbuilt_should_with_disclosure(self):
        self.project['parity_goal'] = 'mvp'
        self.project['scope_approval_evidence_id'] = 'E_SCOPE'
        self.tables['evidence'][-1]['screen_or_state'] = 'SCOPE;MVP'
        self.tables['features'][1]['target_status'] = 'partial'
        self.tables['features'][1]['notes'] = 'Deferred by explicit MVP scope'
        self.persist()
        x = audit(self.root, 'release')
        self.assertTrue(x['passed'], x['errors'])
        self.assertIn('MVP', ' '.join(x['warnings']))

    def test_full_rejects_partial_should(self):
        self.tables['features'][1]['target_status'] = 'partial'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_missing_flow_rejected(self):
        self.tables['flows'] = []
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_flow_unknown_screen_rejected(self):
        self.tables['flows'][0]['screen_ids'] = 'S99'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_documented_interactive_flow_does_not_pass(self):
        self.tables['flows'][0]['source_status'] = 'documented'
        self.tables['flows'][0]['source_evidence_id'] = 'E_DOC'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_excluded_data_without_reason_rejected(self):
        self.tables['data'][0]['required'] = 'no'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_screen_unobserved_rejected(self):
        self.tables['screens'][0]['source_status'] = 'inferred'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_empty_controls_rejected(self):
        self.tables['controls'] = []
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_duplicate_evidence_id_rejected(self):
        self.tables['evidence'].append(copy.deepcopy(self.tables['evidence'][0]))
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_missing_test_rejected(self):
        self.tables['tests'][0]['result'] = 'fail'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_target_cannot_use_source_proof(self):
        self.tables['features'][0]['target_evidence_id'] = 'E_SOURCE'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_data_count_mismatch_rejected(self):
        self.tables['data'][0]['actual_count'] = '29'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_required_data_rights_unknown_rejected(self):
        self.tables['data'][0]['rights'] = 'unknown'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_unbounded_no_strategy_rejected(self):
        self.tables['data'][0]['expected_count'] = ''
        self.tables['data'][0]['actual_count'] = ''
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_unbounded_dynamic_with_strategy_allowed(self):
        self.tables['data'][0]['expected_count'] = ''
        self.tables['data'][0]['actual_count'] = ''
        self.tables['data'][0]['refresh_strategy'] = 'polling daily with sample verification'
        self.tables['data'][0]['notes'] = 'unbounded dynamic feed scoped to fresh items'
        self.persist()
        self.assertTrue(audit(self.root, 'release')['passed'])

    def test_visual_missing_fails(self):
        self.tables['visual_checks'] = []
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_control_without_dependency_map_fails(self):
        self.tables['controls'][0]['backend_dependency'] = ''
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_control_requires_interaction_test(self):
        self.tables['controls'][0]['test_id'] = ''
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_unreferenced_failing_test_blocks(self):
        self.tables['tests'].append({'test_id':'T99','requirement_id':'F02','result':'fail','command':'npx playwright test edge','ran_at':NOW,'revision':'ref-test-revision-1','evidence_id':'E_FEATURE2','notes':''})
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_old_capture_fails(self):
        old = (datetime.now(timezone.utc) - timedelta(days=32)).isoformat()
        self.tables['evidence'][0]['captured_at'] = old
        self.persist()
        x = audit(self.root, 'release')
        self.assertFalse(x['passed'])
        self.assertTrue(any('stale' in v for v in x['errors']))

    def test_old_manifest_fails(self):
        self.project['source_last_checked_at'] = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_open_critical_finding_blocks(self):
        self.tables['findings'][0]['severity'] = 'critical'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_open_medium_finding_blocks(self):
        self.tables['findings'][0]['severity'] = 'medium'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_malformed_bad_data_rejected(self):
        self.tables['data'][0]['expected_count'] = 'thirty'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_noninteractive_nodata_nonvisual_supported(self):
        self.project['interactive'] = False
        self.project['noninteractive_rationale'] = 'Static site, no interactive controls'
        self.project['scope_approval_evidence_id'] = 'E_SCOPE'
        self.tables['evidence'][-1]['screen_or_state'] = 'SCOPE;NO_INTERACTIONS;NO_VISUAL;NO_DATA'
        self.project['data_in_scope'] = False
        self.project['visual_in_scope'] = False
        self.tables['screens'] = []
        self.tables['flows'] = []
        self.tables['controls'] = []
        self.tables['data'] = []
        self.tables['visual_checks'] = []
        self.tables['tests'] = [row for row in self.tables['tests'] if row['requirement_id'] in {'F01', 'F02'}]
        self.persist()
        self.assertTrue(audit(self.root, 'release')['passed'])


    def test_generic_target_proof_reused_across_features_rejected(self):
        self.tables['features'][1]['target_evidence_id'] = 'E_FEATURE1'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_source_evidence_scope_tag_required(self):
        self.tables['evidence'][0]['screen_or_state'] = 'S01'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_target_evidence_scope_tag_required(self):
        self.tables['evidence'][3]['screen_or_state'] = 'wrong'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_same_source_target_uri_rejected(self):
        self.tables['evidence'][3]['source_uri'] = self.tables['evidence'][0]['source_uri']
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_research_only_cannot_release(self):
        self.project['mode'] = 'research-only'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])
        self.assertTrue(audit(self.root, 'recon')['passed'])

    def test_authorized_must_prove_permission(self):
        self.project['mode'] = 'authorized'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])
        self.project['authorization_evidence_id'] = 'E_DOC'
        self.persist()
        self.assertIn('AUTH-tagged', ' '.join(audit(self.root, 'release')['errors']))
        self.project['authorization_evidence_id'] = 'E_AUTH'
        self.persist()
        self.assertTrue(audit(self.root, 'release')['passed'])

    def test_competitor_full_requires_differentiation(self):
        self.project['mode'] = 'public-competitor'
        self.tables['data'][0]['rights'] = 'public-permitted'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])
        self.project['differentiation_scope'] = 'Original identity, clean-room code and user experience'
        self.persist()
        self.assertTrue(audit(self.root, 'release')['passed'])

    def test_no_required_dataset_requires_waiver(self):
        self.tables['data'][0]['required'] = 'no'
        self.tables['data'][0]['notes'] = 'No data migration'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])
        self.project['data_waiver'] = 'Only recreated a static public landing dataset, nothing is owned.'
        self.project['scope_approval_evidence_id'] = 'E_SCOPE'
        self.tables['evidence'][-1]['screen_or_state'] = 'SCOPE;D01;DATA'
        self.persist()
        self.assertTrue(audit(self.root, 'release')['passed'])

    def test_stale_passing_test_rejected(self):
        self.tables['tests'][0]['ran_at'] = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_test_revision_mismatch_rejected(self):
        self.tables['tests'][0]['revision'] = 'old-commit'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_target_revision_missing_rejected(self):
        self.project['target_revision'] = ''
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_visual_score_below_threshold_rejected(self):
        self.tables['visual_checks'][0]['score'] = '8'
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_visual_must_cover_each_screen(self):
        other = copy.deepcopy(self.tables['screens'][0])
        other['screen_id'] = 'S02'
        other['target_evidence_id'] = 'E_S02'
        self.tables['evidence'].append({'evidence_id':'E_S02','status':'observed','source_uri':'test-results/S02.png','captured_at':NOW,'screen_or_state':'S02','confidentiality':'internal','notes':''})
        self.tables['screens'].append(other)
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_scope_can_explicitly_exclude_should(self):
        self.tables['features'][1]['target_status'] = 'out_of_scope'
        self.tables['features'][1]['notes'] = 'Explicitly excluded by contract'
        self.project['scope_approval_evidence_id'] = 'E_SCOPE'
        self.tables['evidence'][-1]['screen_or_state'] = 'SCOPE;F02'
        self.persist()
        self.assertTrue(audit(self.root, 'release')['passed'])

    def test_bad_project_type_fails_cleanly(self):
        self.project['mode'] = ['owned']
        self.project['parity_goal'] = ['full']
        self.persist()
        result = audit(self.root, 'release')
        self.assertFalse(result['passed'])



    def test_owner_provenance_required_even_at_recon(self):
        self.project['ownership_evidence_id'] = ''
        self.persist()
        self.assertIn('ownership_evidence_id', ' '.join(audit(self.root, 'recon')['errors']))

    def test_source_mode_site_requires_noninteractive_reason(self):
        self.project['interactive'] = False
        self.project['noninteractive_rationale'] = ''
        self.persist()
        self.assertIn('noninteractive_rationale', ' '.join(audit(self.root, 'release')['errors']))

    def test_scope_exclusion_must_have_approval(self):
        self.tables['features'][1]['target_status'] = 'out_of_scope'
        self.tables['features'][1]['notes'] = 'owner waived'
        self.persist()
        self.assertIn('SCOPE evidence', ' '.join(audit(self.root, 'release')['errors']))

    def test_approved_scope_evidence_must_have_scope_tag(self):
        self.project['scope_approval_evidence_id'] = 'E_DOC'
        self.tables['features'][1]['target_status'] = 'out_of_scope'
        self.tables['features'][1]['notes'] = 'owner waived'
        self.persist()
        self.assertIn('SCOPE evidence', ' '.join(audit(self.root, 'release')['errors']))

    def test_stale_nonprefixed_target_artifact_rejected(self):
        self.tables['evidence'][4]['source_uri'] = 'https://artifacts.example.test/feature-F01.json'
        self.tables['evidence'][4]['captured_at'] = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        self.persist()
        self.assertIn('Referenced target evidence E_FEATURE1 stale', ' '.join(audit(self.root, 'release')['errors']))

    def test_screen_screenshot_old_revision_rejected(self):
        self.tables['evidence'][2]['revision'] = 'previous-build'
        self.persist()
        self.assertIn('Referenced target evidence E_TARGET revision', ' '.join(audit(self.root, 'release')['errors']))

    def test_test_evidence_matches_requirement(self):
        self.tables['tests'][0]['evidence_id'] = 'E_CONTROL'
        self.persist()
        self.assertIn('Test T01: passing test evidence must match', ' '.join(audit(self.root, 'release')['errors']))

    def test_visual_proof_not_reusable_for_other_claim(self):
        self.tables['visual_checks'][0]['target_evidence_id'] = 'E_TARGET'
        self.persist()
        self.assertIn('reused for independent claim', ' '.join(audit(self.root, 'release')['errors']))

    def test_localhost_evidence_requires_local_exception(self):
        self.tables['evidence'][2]['source_uri'] = 'http://127.0.0.1:8765/screen.png'
        self.persist()
        self.assertIn('local URI needs approved local_testing_exception', ' '.join(audit(self.root, 'release')['errors']))

    def test_local_test_command_requires_local_exception(self):
        self.tables['tests'][0]['command'] = 'playwright test --base-url http://localhost:8765'
        self.persist()
        self.assertIn('local/insecure browser address', ' '.join(audit(self.root, 'release')['errors']))

    def test_private_evidence_git_unsafe_release_blocks(self):
        (self.root / 'evidence-private').mkdir()
        self.persist()
        self.assertFalse(audit(self.root, 'release')['passed'])

    def test_project_templates_match_gate_contract(self):
        templates = Path(__file__).resolve().parents[1] / 'assets/project-template'
        for name, columns in COLUMNS.items():
            with (templates / (name+'.csv')).open() as handle:
                actual = next(csv.reader(handle))
            self.assertEqual(set(actual), set(columns), name)
        project = json.loads((templates / 'project.json').read_text())
        for name in (
            'mode', 'parity_goal', 'scope', 'interactive', 'data_in_scope', 'visual_in_scope',
            'target_revision', 'freshness_policy_days', 'source_origin', 'ownership_evidence_id',
            'authorization_evidence_id', 'scope_approval_evidence_id',
            'min_visual_score', 'remote_preview_url', 'local_testing_exception',
        ):
            self.assertIn(name, project)



    def test_global_identifier_collision_rejected(self):
        self.tables['controls'][0]['control_id'] = 'F01'
        self.persist()
        self.assertIn('Globally ambiguous ID F01', ' '.join(audit(self.root, 'release')['errors']))

    def test_same_artifact_with_different_evidence_id_rejected(self):
        self.tables['evidence'][5]['source_uri'] = self.tables['evidence'][4]['source_uri']
        self.persist()
        self.assertIn('target artifact URI reused', ' '.join(audit(self.root, 'release')['errors']))

    def test_target_uri_matches_other_claims_source_uri_rejected(self):
        self.tables['evidence'][4]['source_uri'] = self.tables['evidence'][1]['source_uri']
        self.persist()
        self.assertIn('artifact URI also used as source evidence', ' '.join(audit(self.root, 'release')['errors']))

    def test_nonpublic_source_origin_must_bind_evidence(self):
        self.project['source_origin'] = 'unrelated-other-site/'
        self.persist()
        self.assertIn('No in-scope source evidence binds to source_origin', ' '.join(audit(self.root, 'release')['errors']))

    def test_preview_private_ip_rejected(self):
        self.project['remote_preview_url'] = 'https://127.0.0.2:8443'
        self.persist()
        self.assertIn('public HTTPS remote_preview_url', ' '.join(audit(self.root, 'release')['errors']))

    def test_docker_localhost_rejected(self):
        self.tables['evidence'][2]['source_uri'] = 'https://host.docker.internal:8765/screen.png'
        self.persist()
        self.assertIn('insecure/local URI needs approved', ' '.join(audit(self.root, 'release')['errors']))

    def test_mvp_requires_scope_approval(self):
        self.project['parity_goal'] = 'mvp'
        self.persist()
        self.assertIn('SCOPE evidence', ' '.join(audit(self.root, 'release')['errors']))

    def test_all_three_scope_switches_require_approval(self):
        for k in ['interactive', 'visual_in_scope', 'data_in_scope']:
            self.project[k] = False
        self.project['noninteractive_rationale'] = 'Static noninteractive feature inventory'
        self.persist()
        self.assertIn('SCOPE evidence', ' '.join(audit(self.root, 'release')['errors']))

    def test_scope_approval_tags_each_exclusion(self):
        self.tables['features'][1]['target_status'] = 'out_of_scope'
        self.tables['features'][1]['notes'] = 'Owner approved'
        self.project['scope_approval_evidence_id'] = 'E_SCOPE'
        self.persist()
        self.assertIn('explicit exception tag F02', ' '.join(audit(self.root, 'release')['errors']))

    def test_rights_evidence_specific_to_dataset(self):
        self.tables['data'][0]['rights_evidence_id'] = 'E_DOC'
        self.persist()
        self.assertIn('D01-tagged RIGHTS evidence', ' '.join(audit(self.root, 'release')['errors']))

    def test_ownership_and_scope_proof_cannot_be_same(self):
        self.project['scope_approval_evidence_id'] = 'E_OWN'
        self.tables['features'][1]['target_status'] = 'out_of_scope'
        self.tables['features'][1]['notes'] = 'Owner approved'
        self.persist()
        self.assertIn('separate internal owner-approved', ' '.join(audit(self.root, 'release')['errors']))

    def test_stale_documented_source_rejected(self):
        self.tables['evidence'][1]['captured_at'] = (datetime.now(timezone.utc) - timedelta(days=35)).isoformat()
        self.persist()
        self.assertIn('Referenced source evidence E_DOC', ' '.join(audit(self.root, 'release')['errors']))

    def test_extreme_freshness_policy_requires_approval(self):
        self.project['freshness_policy_days'] = 36500
        self.persist()
        self.assertIn('Freshness policy longer than 30', ' '.join(audit(self.root, 'release')['errors']))

    def test_inadequate_visual_threshold_requires_approval(self):
        self.project['min_visual_score'] = 0
        self.persist()
        self.assertIn('Visual threshold below 75', ' '.join(audit(self.root, 'release')['errors']))



    def test_approval_pointer_cannot_bypass_long_freshness(self):
        self.project['freshness_policy_days'] = 36500
        self.project['scope_approval_evidence_id'] = 'x'
        self.persist()
        self.assertIn('SCOPE evidence', ' '.join(audit(self.root, 'release')['errors']))

    def test_approval_pointer_cannot_bypass_visual_floor(self):
        self.project['min_visual_score'] = 0
        self.project['scope_approval_evidence_id'] = 'x'
        self.persist()
        self.assertIn('SCOPE evidence', ' '.join(audit(self.root, 'release')['errors']))

    def test_scope_approval_must_explicitly_allow_low_visual(self):
        self.project['min_visual_score'] = 0
        self.project['scope_approval_evidence_id'] = 'E_SCOPE'
        self.persist()
        self.assertIn('LOW_VISUAL', ' '.join(audit(self.root, 'release')['errors']))

    def test_numeric_loopback_preview_rejected(self):
        for uri in ['https://2130706433:443/', 'https://0x7f000001/']:
            self.project['remote_preview_url'] = uri
            self.persist()
            self.assertIn('public HTTPS remote_preview_url', ' '.join(audit(self.root, 'release')['errors']))

    def test_file_url_needs_local_scope(self):
        self.tables['evidence'][2]['source_uri'] = 'file:///tmp/source/target.png'
        self.persist()
        self.assertIn('insecure/local URI', ' '.join(audit(self.root, 'release')['errors']))

    def test_bare_loopback_test_command_rejected(self):
        self.tables['tests'][0]['command'] = 'test against 127.0.0.1:8765'
        self.persist()
        self.assertIn('local/insecure browser address', ' '.join(audit(self.root, 'release')['errors']))

    def test_uri_fragment_reuse_rejected(self):
        self.tables['evidence'][4]['source_uri'] = 'test-results/common.json#F01'
        self.tables['evidence'][5]['source_uri'] = 'test-results/common.json#F02'
        self.persist()
        self.assertIn('target artifact URI reused', ' '.join(audit(self.root, 'release')['errors']))

    def test_source_origin_boundary_not_foo_evil(self):
        self.project['source_origin'] = 'https://owner-site.example'
        self.tables['evidence'][0]['source_uri'] = 'https://owner-site.example.evil.net/screens'
        self.persist()
        self.assertIn('No in-scope source evidence binds to source_origin', ' '.join(audit(self.root, 'release')['errors']))

    def test_rights_proof_stale_rejected(self):
        self.tables['evidence'][-2]['captured_at'] = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        self.persist()
        self.assertIn('RIGHTS evidence stale', ' '.join(audit(self.root, 'release')['errors']))

    def test_rights_and_scope_proofs_must_be_distinct(self):
        self.tables['evidence'][-2]['screen_or_state'] = 'RIGHTS;D01;SCOPE;MVP'
        self.project['parity_goal'] = 'mvp'
        self.project['scope_approval_evidence_id'] = 'E_RIGHTS'
        self.persist()
        self.assertIn('RIGHTS evidence must be distinct', ' '.join(audit(self.root, 'release')['errors']))

    def test_reserved_record_ids_rejected(self):
        self.tables['features'][0]['feature_id'] = 'SCOPE'
        self.persist()
        self.assertIn('Reserved scope tag', ' '.join(audit(self.root, 'release')['errors']))



if __name__ == '__main__':
    unittest.main()
