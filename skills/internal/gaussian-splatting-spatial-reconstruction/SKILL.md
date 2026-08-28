---
name: gaussian-splatting-spatial-reconstruction
description: Use for physical-space or object reconstruction, spatial visualisation, or novel-view rendering with 3D Gaussian Splatting. Treat it as one candidate technique and gate execution by data, hardware, privacy, alternatives, and license.
---

# Gaussian Splatting Spatial Reconstruction

## Use when

Use this skill for reconstruction of a consented room, site, object, or
environment from images or video; COLMAP-to-splat workflows; trained `.ply`
splats; novel-view rendering; 3D scene capture; spatial visualisation; and
related computer-vision or spatial-computing tasks.

Do not use it for Gaussian blur, scatter plots, generic point-cloud questions
with no reconstruction intent, or a request that only needs an existing 3D
asset pipeline.

## Decision gates

Before execution, record:

- the user goal and expected output: capture preparation, training,
  evaluation, conversion, viewing, or product integration;
- image/video coverage, camera calibration, resolution, scene scale, and
  expected fidelity;
- consent, ownership, retention, and whether the scene contains people,
  private spaces, or identifying location detail;
- available GPU, VRAM, CUDA, compiler, operating system, storage, and runtime
  isolation;
- commercial, professional, research, or evaluation use;
- viable alternatives such as mesh reconstruction, NeRF, photogrammetry,
  depth capture, or a maintained commercial implementation; and
- the exact implementation, revision, dependencies, and license.

## Reference workflow

1. Classify the capability with `docs/capability-maturity-model.md`. Default to
   `reference` until a real use case and the license permit a deeper stage.
2. Preserve capture provenance and obtain explicit consent for the source
   images, video, camera poses, point clouds, meshes, and splats.
3. Evaluate the official GraphDeco reference only in an isolated,
   non-commercial research or evaluation environment. Its repository uses a
   custom license that restricts use to non-commercial research/evaluation
   unless the licensors give explicit permission.
4. For an authorised evaluation, verify the COLMAP inputs, recursive
   submodules, supported CUDA/PyTorch environment, GPU/VRAM budget, output
   path, storage headroom, and offline boundary before installation.
5. Validate a representative consented scene. Check input completeness,
   training/render output, resource use, reproducibility, and retention or
   deletion behavior.
6. For commercial work, repeat implementation discovery and choose a
   maintained implementation with compatible commercial rights before any
   execution or adapter work.

## Constraints

- A paper or repository reference is not an installed adapter or native
  capability.
- Do not vendor, install globally, wrap, execute, or redistribute the
  GraphDeco code for a commercial/product path without explicit permission.
- Do not claim offline support if weights, submodules, packages, or assets
  were fetched during the run.
- Keep spatial inputs and outputs project-local. Do not upload real scenes or
  people without explicit authority.
- Promote from reference to skill, adapter, and native only when each stage
  has representative evidence, a stable test path, compatible licensing, and
  justified dependency cost.

## Output

Return the selected technique and exact implementation, license, maturity
stage, data and consent basis, hardware/runtime evidence, observed output,
alternatives considered, and deferred gates.

## Provenance

Reference: `graphdeco-inria/gaussian-splatting`, the official authors'
implementation of 3D Gaussian Splatting, reviewed on 2026-08-28 at revision
`54c035f7834b564019656c3e3fcc3646292f727d`. The reference license is custom
and non-commercial research/evaluation. No upstream source is copied into
Major.
